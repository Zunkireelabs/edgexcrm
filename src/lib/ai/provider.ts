import { openai } from "@ai-sdk/openai";
import { anthropic } from "@ai-sdk/anthropic";
import { MODELS, ACTIVE_PROVIDER } from "./models";

const PROVIDER_KEY_ENV: Record<"openai" | "anthropic", string> = {
  openai: "OPENAI_API_KEY",
  anthropic: "ANTHROPIC_API_KEY",
};

// Returns an AI SDK model instance for a logical role. Swapping providers is one env var
// (AI_PROVIDER, see models.ts). A configured provider with no matching key fails loudly
// here rather than silently falling back to the other vendor — a silent fallback would
// send customer data to a sub-processor the client's consent doesn't name.
export function model(kind: "agent" | "fast") {
  const keyEnvVar = PROVIDER_KEY_ENV[ACTIVE_PROVIDER];
  if (!process.env[keyEnvVar]) {
    throw new Error(
      `AI_PROVIDER is set to "${ACTIVE_PROVIDER}" but ${keyEnvVar} is not set. Refusing to fall back to another provider — set ${keyEnvVar} or change AI_PROVIDER.`
    );
  }
  const id = MODELS[ACTIVE_PROVIDER][kind];
  return ACTIVE_PROVIDER === "anthropic" ? anthropic(id) : openai(id);
}

// OpenAI retains prompt + completion content in our org logs unless `store: false`
// rides on the request (true for both the Chat and Responses paths `openai(id)` can
// resolve to). We get nothing for that retention and D5 makes no promise that depends
// on it, so it's pure downside exposure — turn it off on every language-model call.
//
// This can't be centralised on the model instance: the AI SDK's openai provider
// (v4) takes only a model id — `openai(id)` has no settings argument — so provider
// options must be passed per call. This helper centralises the *value* instead, so
// every `model()` consumer spreads the same thing into its
// streamText/generateText/generateObject call and a new call site can't quietly
// diverge. Anthropic has no equivalent knob and its console has no comparable
// retention default; returns undefined there so nothing extra is sent.
export function aiRequestProviderOptions(): { openai: { store: false } } | undefined {
  return ACTIVE_PROVIDER === "openai" ? { openai: { store: false } } : undefined;
}
