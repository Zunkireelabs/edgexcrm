// The ONLY place model ids live. Provider swap = set ANTHROPIC_API_KEY (see provider.ts).
export const MODELS = {
  openai: { agent: "gpt-4o-mini", fast: "gpt-4o-mini" }, // demo default — mini tier to conserve budget
  anthropic: { agent: "claude-sonnet-5", fast: "claude-haiku-4-5" }, // activates when ANTHROPIC_API_KEY is set
} as const;

export const ACTIVE_PROVIDER: "openai" | "anthropic" = process.env.ANTHROPIC_API_KEY
  ? "anthropic"
  : "openai";
