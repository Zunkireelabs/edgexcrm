import { openai } from "@ai-sdk/openai";
import { anthropic } from "@ai-sdk/anthropic";
import { MODELS, ACTIVE_PROVIDER } from "./models";

// Returns an AI SDK model instance for a logical role. Swapping providers is one env var.
export function model(kind: "agent" | "fast") {
  const id = MODELS[ACTIVE_PROVIDER][kind];
  return ACTIVE_PROVIDER === "anthropic" ? anthropic(id) : openai(id);
}
