// Phase 1A defines the flag only; 1B/1C gate the chat route and UI on it.
export function isAssistantEnabled(): boolean {
  return process.env.AI_ASSISTANT_ENABLED === "true";
}

// Phase 2B prod-safety switch: flag off => KB item routes behave exactly as
// today (status 'ready', no Inngest event). Flip on once the ADR-001 D5
// privacy gate is signed.
export function isIngestionEnabled(): boolean {
  return process.env.AI_INGESTION_ENABLED === "true";
}
