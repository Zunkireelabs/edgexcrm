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
  produces: string[];
  guarantee: string;
}

const DRAFT_ONLY_GUARANTEE =
  "Cannot change your CRM directly — every suggestion goes to your review queue.";

const TRIGGER_EVENT_PHRASES: Record<string, string> = {
  "crm/lead.created": "When a new lead is created",
};

const READ_TOOL_PHRASES: Record<string, string> = {
  get_lead: "read a lead's full profile",
  search_leads: "search across leads",
};

const DRAFT_TOOL_PHRASES: Record<string, string> = {
  propose_score: "draft a fit/quality score",
  propose_task: "draft a follow-up task",
  propose_email: "draft a follow-up email",
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

/**
 * Derives a human-readable capability summary from an agent's static
 * definition — what triggers it, what it can read, what it can draft, and
 * what it produces. Defensive against partial/unknown data (new tool ids,
 * new trigger events) so the 5.3 registry can grow without this throwing.
 */
export function describeCapabilities(def: AgentDefinition): AgentCapabilitySummary {
  const reads: string[] = [];
  const drafts: string[] = [];

  for (const toolId of def.toolIds ?? []) {
    if (toolId.startsWith("propose_") || DRAFT_TOOL_PHRASES[toolId]) {
      drafts.push(DRAFT_TOOL_PHRASES[toolId] ?? `draft a ${humanize(toolId)}`);
    } else {
      reads.push(READ_TOOL_PHRASES[toolId] ?? humanize(toolId));
    }
  }

  return {
    trigger: (def.triggers ?? []).map(triggerPhrase).join(" or "),
    reads,
    drafts,
    produces: (def.outputKinds ?? []).map(outputLabel),
    guarantee: DRAFT_ONLY_GUARANTEE,
  };
}
