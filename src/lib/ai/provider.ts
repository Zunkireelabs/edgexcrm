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
