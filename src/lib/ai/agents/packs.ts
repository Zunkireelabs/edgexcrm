// Module-load registration aggregator for background AgentDefinitions —
// mirrors src/lib/ai/tools/packs.ts exactly. Every consumer that reads the
// agent registry (runtime, queries, Inngest agent functions) imports this
// ONCE, for its side effect, before calling getAgentDefinition(s)... so
// universal defs (./registry) and every industry's agent pack
// (src/industries/<id>/ai/agents/*.ts) are registered first. Adding an
// agent pack is one import line here.
import "./registry";
import "@/industries/education-consultancy/ai/agents";
