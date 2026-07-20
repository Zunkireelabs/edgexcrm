// The ONLY place model ids live. Provider swap = set AI_PROVIDER (see provider.ts).
export const MODELS = {
  openai: { agent: "gpt-4o-mini", fast: "gpt-4o-mini" }, // demo default — mini tier to conserve budget
  anthropic: { agent: "claude-sonnet-5", fast: "claude-haiku-4-5" },
} as const;

// AI_PROVIDER is read explicitly rather than sniffed from ANTHROPIC_API_KEY's
// presence — the set of third parties receiving customer data (leads, notes,
// KB documents) must change only via a deliberate, reviewable config change,
// never by someone adding a key to the environment. Changing this value
// changes the disclosed sub-processor set and requires a privacy-disclosure
// update (ADR-001 Decision 5) before it ships to any tenant with signed
// consent naming the current provider. Default "openai" matches prod today.
function resolveProvider(): "openai" | "anthropic" {
  const raw = process.env.AI_PROVIDER;
  if (raw === undefined || raw === "") return "openai";
  if (raw === "openai" || raw === "anthropic") return raw;
  throw new Error(`Invalid AI_PROVIDER "${raw}" — must be "openai" or "anthropic".`);
}

export const ACTIVE_PROVIDER: "openai" | "anthropic" = resolveProvider();
