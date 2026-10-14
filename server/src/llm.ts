import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { ChatGoogleGenerativeAI } from "@langchain/google-genai";
import { ChatMistralAI } from "@langchain/mistralai";
import { ChatOpenAI } from "@langchain/openai";
import { AppError } from "./errors.js";

export const PROVIDERS = ["gemini", "qwen", "mistral", "kimi", "llama"] as const;
export type Provider = (typeof PROVIDERS)[number];

// Hard limit per model call, enforced in agents.ts (the Gemini SDK ignores the abort signal).
// Normal calls on a 20-page SOP take 40–115s; slower ones are cut off and retried once.
const CALL_TIMEOUT_MS = 150_000;
// A3 (refine and claim audit) reads every A1 pass at once and rewrites the whole claim set, so it
// runs 130–180s on the same SOP, and past 240s once the lenses and gap-fill passes feed it ~140
// claims. A cut-off A3 call is not retried (agents.ts), so this limit is its only chance.
const LONG_CALL_TIMEOUT_MS = 360_000;

export function defaultProvider(): Provider {
  const p = (process.env.PROVIDER ?? "gemini").toLowerCase();
  if (!(PROVIDERS as readonly string[]).includes(p)) throw new Error(`PROVIDER must be one of ${PROVIDERS.join(", ")}, got "${p}"`);
  return p as Provider;
}

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new AppError("PROVIDER_NOT_CONFIGURED", `Missing ${name} in .env (needed for the selected provider). Configure it, or switch this job to Copilot Chat.`);
  return value;
}

// Kimi and Llama have no maintained LangChain.js package, so they use ChatOpenAI against their
// OpenAI-compatible endpoint (as Qwen does). json: OpenAI JSON mode (response_format json_object).
function openAICompatible(prefix: string, json: boolean): { model: BaseChatModel; modelId: string } {
  const modelId = required(`${prefix}_MODEL`);
  const model = new ChatOpenAI({
    model: modelId,
    apiKey: required(`${prefix}_API_KEY`),
    configuration: { baseURL: required(`${prefix}_BASE_URL`) },
    temperature: 0,
    maxRetries: 0,
    timeout: LONG_CALL_TIMEOUT_MS, // the per-role limit is enforced in agents.ts
    ...(json && { modelKwargs: { response_format: { type: "json_object" } } }),
  });
  return { model, modelId };
}

// One LangChain adapter per provider profile (FSD §6.2). Model IDs come only from .env: one
// <PREFIX>_MODEL per provider, used for text and image prompts alike, so it must accept images.
// json: the provider's JSON mode for A1–A4; thinking stays at the model default.
// maxRetries: 0 everywhere: retries are handled in agents.ts, so they are bounded and show in the trace.
export function getModel(provider: Provider, json = false): { model: BaseChatModel; modelId: string } {
  switch (provider) {
    case "gemini": {
      const modelId = required("GEMINI_MODEL");
      const model = new ChatGoogleGenerativeAI({ model: modelId, apiKey: required("GOOGLE_API_KEY"), temperature: 0, maxRetries: 0, json });
      return { model, modelId };
    }
    case "mistral": {
      const modelId = required("MISTRAL_MODEL");
      const model = new ChatMistralAI({
        model: modelId,
        apiKey: required("MISTRAL_API_KEY"),
        serverURL: process.env.MISTRAL_BASE_URL || undefined, // SDK default: https://api.mistral.ai
        temperature: 0,
        maxRetries: 0,
        ...(json && { responseFormat: { type: "json_object" } }),
      });
      return { model, modelId };
    }
    case "qwen":
      return openAICompatible("QWEN", false);
    case "kimi":
      return openAICompatible("KIMI", json);
    case "llama":
      return openAICompatible("LLAMA", json);
  }
}

export { CALL_TIMEOUT_MS, LONG_CALL_TIMEOUT_MS };
