// Module-load registration aggregator — the chat route imports this ONCE
// instead of each pack individually. Adding a new industry pack is a single
// line here; no route edit needed.
// TODO(Phase 3): drive this from each industry manifest's AiConfig.toolIds
// instead of a hardcoded import list.
import "./universal";
import "@/industries/real-estate/ai/tools";
