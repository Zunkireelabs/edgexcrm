// Phase 1A defines the flag only; 1B/1C gate the chat route and UI on it.
export function isAssistantEnabled(): boolean {
  return process.env.AI_ASSISTANT_ENABLED === "true";
}
