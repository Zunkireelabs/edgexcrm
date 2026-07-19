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

// Phase 4A prod-safety switch: flag off => buildToolset() excludes every
// scope:"write" tool, so today's read-only toolset is byte-identical. Ships
// dark everywhere but local until Sadin signs off flipping stage (04-PHASE-4 §0.1).
export function isWriteToolsEnabled(): boolean {
  return process.env.AI_WRITE_TOOLS_ENABLED === "true";
}
