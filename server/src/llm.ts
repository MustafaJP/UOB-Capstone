import type { BaseChatModel } from "@langchain/core/language_models/chat_models";
import { ChatGoogleGenerativeAI } from "@langchain/google-genai";
import { ChatOpenAI } from "@langchain/openai";
import { AppError } from "./errors.js";

export type Provider = "gemini" | "qwen";
export const PROVIDERS: Provider[] = ["gemini", "qwen"];

// Hard limit per model call, enforced in agents.ts (the Gemini SDK ignores the abort signal).
// Normal calls on a 20-page SOP take 40–115s; slower ones are cut off and retried once.
const CALL_TIMEOUT_MS = 150_000;
// A3 (refine and claim audit) reads every A1 pass at once and rewrites the whole claim set, so it
// runs 130–180s on the same SOP, and past 240s once the lenses and gap-fill passes feed it ~140
// claims. A cut-off A3 call is not retried (agents.ts), so this limit is its only chance.
const LONG_CALL_TIMEOUT_MS = 360_000;

export function defaultProvider(): Provider {
  const p = (process.env.PROVIDER ?? "gemini").toLowerCase();
  if (p !== "gemini" && p !== "qwen") throw new Error(`PROVIDER must be gemini or qwen, got "${p}"`);
  return p;
}

function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new AppError("PROVIDER_NOT_CONFIGURED", `Missing ${name} in .env (needed for the selected provider). Configure it, or switch this job to Copilot Chat.`);
  return value;
}

// One adapter per provider profile (FSD §6.2). Model IDs come only from .env.
// json: Gemini JSON mode (responseMimeType application/json); thinking stays at the model default.
export function getModel(provider: Provider, vision: boolean, json = false): { model: BaseChatModel; modelId: string } {
  if (provider === "gemini") {
    const modelId = required("GEMINI_MODEL");
    const model = new ChatGoogleGenerativeAI({
      model: modelId,
      apiKey: required("GOOGLE_API_KEY"),
      temperature: 0,
      maxRetries: 0, // retries are handled in agents.ts, so they are bounded and show in the trace
      json,
    });
    return { model, modelId };
  }
  const modelId = vision ? required("QWEN_VISION_MODEL") : required("QWEN_MODEL");
  const model = new ChatOpenAI({
    model: modelId,
    apiKey: required("QWEN_API_KEY"),
    configuration: { baseURL: required("QWEN_BASE_URL") },
    temperature: 0,
    maxRetries: 0,
    timeout: LONG_CALL_TIMEOUT_MS, // the per-role limit is enforced in agents.ts
  });
  return { model, modelId };
}

export { CALL_TIMEOUT_MS, LONG_CALL_TIMEOUT_MS };
