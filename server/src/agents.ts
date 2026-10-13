import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { AIMessage, HumanMessage, SystemMessage, type BaseMessage } from "@langchain/core/messages";
import { CALL_TIMEOUT_MS, getModel, type Provider } from "./llm.js";
import type { BuiltPrompt } from "./prompts.js";
import { OUTPUT_SCHEMAS, type OutputKind } from "./schemas.js";

import { AppError } from "./errors.js";

export { AppError };

const MAX_RESPONSE_BYTES = 5 * 1024 * 1024;

export type ParseResult<T> = { ok: true; value: T } | { ok: false; errors: string[] };

type Output<K extends OutputKind> = (typeof OUTPUT_SCHEMAS)[K]["_output"];

/**
 * Validate a model or pasted response against the expected output schema
 * (a role's normal output, or A4_PATCH for a repair).
 * strict (Copilot Chat import): one JSON object, optionally inside one ```json fence, nothing else.
 * lenient (API): also tolerates prose around the object.
 */
export function parseRoleOutput<K extends OutputKind>(kind: K, raw: string, strict: boolean): ParseResult<Output<K>> {
  if (Buffer.byteLength(raw, "utf8") > MAX_RESPONSE_BYTES) return { ok: false, errors: ["Response is larger than 5 MiB."] };
  let text = raw.trim();
  const fenced = text.match(/^```(?:json)?\s*\n([\s\S]*?)\n?```$/);
  if (fenced) text = fenced[1].trim();
  else if (!strict) {
    const start = text.indexOf("{");
    const end = text.lastIndexOf("}");
    if (start >= 0 && end > start) text = text.slice(start, end + 1);
  }
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch (e) {
    return { ok: false, errors: [`Not valid JSON: ${(e as Error).message}. The response may be truncated or have extra text.`] };
  }
  const result = OUTPUT_SCHEMAS[kind].safeParse(data);
  if (!result.success) {
    return {
      ok: false,
      errors: result.error.issues.slice(0, 25).map((i) => `${i.path.join(".") || "(root)"}: ${i.message}`),
    };
  }
  return { ok: true, value: result.data as Output<K> };
}

function toMessages(p: BuiltPrompt): BaseMessage[] {
  const human =
    p.images.length === 0
      ? new HumanMessage(p.user)
      : new HumanMessage({
          content: [
            { type: "text", text: p.user },
            ...p.images.map((img) => ({
              type: "image_url" as const,
              image_url: { url: `data:${img.mime};base64,${img.base64}` },
            })),
          ],
        });
  return [new SystemMessage(p.system), human];
}

const CALL_ATTEMPTS = 2; // one retry after a timeout, rate limit or server error
const MAX_RETRY_WAIT_MS = 60_000; // a rate limit asking for a longer wait fails instead of stalling the job

class CallTimeout extends Error {}

/**
 * The Gemini SDK ignores the abort signal, so race the call against our own timer.
 * The abandoned request may still finish in the background; its result is discarded.
 */
async function invokeWithTimeout(model: BaseChatModel, messages: BaseMessage[], timeoutMs: number): Promise<AIMessage> {
  const controller = new AbortController();
  let timer: NodeJS.Timeout | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      controller.abort();
      reject(new CallTimeout(`no reply within ${timeoutMs / 1000}s`));
    }, timeoutMs);
  });
  try {
    return (await Promise.race([model.invoke(messages, { signal: controller.signal }), timeout])) as AIMessage;
  } finally {
    clearTimeout(timer);
  }
}

/** Seconds the provider asks us to wait ("Please retry in 39.2s"), if it says. */
function retryDelayMs(msg: string): number | null {
  const m = msg.match(/retry in ([\d.]+)s/i);
  return m ? Math.ceil(Number(m[1]) * 1000) : null;
}

/**
 * One model call with a hard timeout and at most one retry. A daily quota or a long rate-limit
 * wait fails at once, so the job can switch provider or mode instead of hanging.
 */
async function invokeWithRetry(
  model: BaseChatModel,
  messages: BaseMessage[],
  label: string,
  notes: string[],
): Promise<{ reply: AIMessage; requests: number }> {
  for (let attempt = 1; ; attempt++) {
    try {
      return { reply: await invokeWithTimeout(model, messages), requests: attempt };
    } catch (e) {
      const msg = (e as Error).message ?? String(e);
      if (/PerDay/i.test(msg)) {
        throw new AppError("PROVIDER_UNAVAILABLE", `${label}: daily request quota exhausted. ${msg}`, false);
      }
      const timedOut = e instanceof CallTimeout;
      // Word boundaries matter: every Gemini error message contains "generateContent".
      const retryable = timedOut || /\b429\b|rate.?limit|quota|overloaded|unavailable|ECONN|fetch failed|\b5\d\d\b/i.test(msg);
      if (!retryable) throw new AppError("PROVIDER_ERROR", `${label} call failed: ${msg}`, false);
      const wait = timedOut ? 0 : retryDelayMs(msg) ?? 5_000;
      if (attempt >= CALL_ATTEMPTS || wait > MAX_RETRY_WAIT_MS) {
        throw new AppError("PROVIDER_UNAVAILABLE", `${label} call failed after ${attempt} attempt(s): ${msg}`, true);
      }
      notes.push(timedOut ? `retried after ${CALL_TIMEOUT_MS / 1000}s timeout` : `retried after provider error (waited ${Math.round(wait / 1000)}s)`);
      await new Promise((r) => setTimeout(r, wait));
    }
  }
}

/**
 * Path A: call the provider, validate locally, and allow one format correction (FSD §19.9).
 * Returns the number of requests issued so the graph can enforce the job budget,
 * plus notes on any retries or corrections for the trace.
 */
export async function callAgent<K extends OutputKind>(
  kind: K,
  prompt: BuiltPrompt,
  provider: Provider,
): Promise<{ output: Output<K>; requests: number; modelId: string; notes: string[] }> {
  const role = prompt.role;
  // A1–A4 (including the A4 repair patch) run in JSON mode; the reply is then parsed and validated below.
  const { model, modelId } = getModel(provider, prompt.images.length > 0, role !== "A5");
  const messages = toMessages(prompt);
  const notes: string[] = [];
  let requests = 0;
  let lastErrors: string[] = [];

  for (let attempt = 0; attempt < 2; attempt++) {
    if (attempt > 0) notes.push("needed 1 format correction");
    const call = await invokeWithRetry(model, messages, `${role} (${provider})`, notes);
    requests += call.requests;
    const reply = call.reply;
    const raw = reply.text;
    const parsed = parseRoleOutput(kind, raw, false);
    if (parsed.ok) return { output: parsed.value, requests, modelId, notes };

    lastErrors = parsed.errors;
    messages.push(
      new AIMessage(raw),
      new HumanMessage(
        `Your response failed validation:\n${parsed.errors.join("\n")}\n` +
          `Return one complete JSON object using the same evidence. Correct the format only; ` +
          `do not add unsupported facts or omit coverage.`,
      ),
    );
  }
  throw new AppError("AI_OUTPUT_INVALID", `${role} returned invalid output twice`, false, lastErrors);
}
