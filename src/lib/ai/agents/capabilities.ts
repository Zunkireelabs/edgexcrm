// Module-load registration — MUST run before getRegisteredTools() below,
// exactly as runtime.ts does. Without it this module's only caller path
// (queries.ts -> agents/packs -> here) leaves the TOOL registry empty:
// agents/packs registers agent DEFINITIONS, not tools, and nothing else in
// that graph pulls the tool packs in. An empty registry makes
// registeredToolScope() return undefined for every id, which silently
// misclassifies a write tool as a read AND falls back to the draft-only
// guarantee — reintroducing the exact stale-guarantee bug 5.4a exists to fix.
import "@/lib/ai/tools/packs";
import { getRegisteredTools } from "@/lib/ai/tools/registry";
import type { AgentDefinition, AgentOutputKind, AgentTrigger } from "./types";
import { KIND_LABELS } from "./labels";

/**
 * Serializable summary of what an AgentDefinition will do — derived from data
 * we already have (triggers/toolIds/outputKinds), no new agent behavior. Crosses
 * the server->client boundary as a plain prop (AgentFleetItem/AgentCatalogEntry),
 * so it must stay JSON-serializable: strings and string arrays only, no functions.
 */
export interface AgentCapabilitySummary {
  trigger: string;
  reads: string[];
  drafts: string[];
  writes: string[];
  produces: string[];
  guarantee: string;
}

const DRAFT_ONLY_GUARANTEE =
  "Cannot change your CRM directly — every suggestion goes to your review queue.";

// 5.4a: a declared registry write-scope tool no longer means "draft-only" —
// its writes are policy-gated (agent_tool_policies), not structurally
// impossible. Distinct copy so admins evaluating an agent for hire see the
// real guarantee, not a stale "cannot change your CRM" claim.
const POLICY_GATED_WRITE_GUARANTEE =
  "Can change your CRM data for the actions listed below, subject to your tenant's approval settings for this agent.";

const TRIGGER_EVENT_PHRASES: Record<string, string> = {
  "crm/lead.created": "When a new lead is created",
};

const READ_TOOL_PHRASES: Record<string, string> = {
  get_lead: "read a lead's full profile",
  search_leads: "search across leads",
  pipeline_summary: "read the pipeline summary",
};

const DRAFT_TOOL_PHRASES: Record<string, string> = {
  propose_score: "draft a fit/quality score",
  propose_task: "draft a follow-up task",
  propose_email: "draft a follow-up email",
  propose_digest: "compile the daily digest",
};

// Exported: reused by getAgentDetail (queries.ts) as the human label on each
// row of the per-agent automation matrix (5.4d Part 5) — one source of
// truth for "what does this write tool do" copy, shared with the capability
// summary above.
export const WRITE_TOOL_PHRASES: Record<string, string> = {
  update_lead_stage: "move a lead between stages",
  assign_lead: "assign a lead to a team member",
  create_task: "create a task",
  create_lead_note: "add a note to a lead",
  create_knowledge_item: "write a knowledge-base item",
  undo_lead_action: "undo a prior lead change",
};

/** Best-effort de-slugify for any id this map doesn't (yet) know about — keeps unknown ids readable instead of throwing. */
function humanize(id: string): string {
  const stripped = id.replace(/^(get_|search_|list_|propose_)/, "");
  const words = stripped.replace(/[/.]/g, " ").replace(/[_-]/g, " ").trim();
  return words || id;
}

function triggerPhrase(trigger: AgentTrigger): string {
  if ("cron" in trigger) return `On a schedule (${trigger.cron})`;
  if (trigger.event === "manual") return "When run manually";
  return TRIGGER_EVENT_PHRASES[trigger.event] ?? `When ${humanize(trigger.event)} occurs`;
}

function outputLabel(kind: AgentOutputKind): string {
  return KIND_LABELS[kind] ?? humanize(kind);
}

/** The registry's own scope for this tool id, or undefined for a non-registry id (draft tools, e.g. propose_score). */
function registeredToolScope(toolId: string): "read" | "write" | undefined {
  return getRegisteredTools().find((t) => t.id === toolId)?.scope;
}

/**
 * Derives a human-readable capability summary from an agent's static
 * definition — what triggers it, what it can read, draft, or (5.4a) write,
 * and what it produces. Defensive against partial/unknown data (new tool
 * ids, new trigger events) so the 5.3 registry can grow without this
 * throwing.
 */
export function describeCapabilities(def: AgentDefinition): AgentCapabilitySummary {
  const reads: string[] = [];
  const drafts: string[] = [];
  const writes: string[] = [];

  for (const toolId of def.toolIds ?? []) {
    // Classify by the registry tool's ACTUAL scope first — an id that
    // happens to lack a "propose_" prefix (e.g. update_lead_stage) must
    // never be misclassified as a read just because of its name.
    if (registeredToolScope(toolId) === "write") {
      writes.push(WRITE_TOOL_PHRASES[toolId] ?? `change ${humanize(toolId)}`);
    } else if (toolId.startsWith("propose_") || DRAFT_TOOL_PHRASES[toolId]) {
      drafts.push(DRAFT_TOOL_PHRASES[toolId] ?? `draft a ${humanize(toolId)}`);
    } else {
      reads.push(READ_TOOL_PHRASES[toolId] ?? humanize(toolId));
    }
  }

  return {
    trigger: (def.triggers ?? []).map(triggerPhrase).join(" or "),
    reads,
    drafts,
    writes,
    produces: (def.outputKinds ?? []).map(outputLabel),
    guarantee: writes.length > 0 ? POLICY_GATED_WRITE_GUARANTEE : DRAFT_ONLY_GUARANTEE,
  };
}
