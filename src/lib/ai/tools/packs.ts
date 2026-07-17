// Module-load registration aggregator — the chat route imports this ONCE
// instead of each pack individually. Next.js bundling needs static imports,
// so this list stays hardcoded (no dynamic import() of packs). Adding a
// pack is two steps, both required: (a) one import line here, (b) that
// industry's manifest declares matching `toolIds` (and usually a
// `promptAddendum`) in its AiConfig. packs.test.ts asserts both — it fails
// if a tool is registered here but undeclared in the manifest, or declared
// in a manifest but never actually registered.
import "./universal";
import "@/industries/real-estate/ai/tools";
