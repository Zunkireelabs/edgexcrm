// Module-load registration point for the education_consultancy background
// agent pack — imported (for its side effect) by src/lib/ai/agents/packs.ts
// so this industry's agent defs are registered before the registry is read.
// Mirrors the sibling ./tools/index.ts pattern for the assistant tool pack.
import "./follow-up-drafter";
