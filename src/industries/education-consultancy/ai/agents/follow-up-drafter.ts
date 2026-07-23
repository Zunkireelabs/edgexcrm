import { INDUSTRIES } from "@/industries/_registry";
import { registerAgentDefinition } from "@/lib/ai/agents/registry";
import type { AgentDefinition } from "@/lib/ai/agents/types";

/**
 * Follow-up Drafter (education_consultancy, doc 03 §4) — the first
 * industry-scoped background agent. Runs whenever a lead is assigned to a
 * counselor and drafts a personalized first-outreach email for that
 * counselor to review. Draft-only — propose_email is the only "write" it
 * can make, and it lands in agent_outputs for human review; it cannot send
 * the email or change the lead.
 */
export const followUpDrafterAgent: AgentDefinition = {
  key: "follow-up-drafter",
  name: "Follow-up Drafter",
  description: "Drafts a personalized first-outreach email when a lead is assigned to a counselor.",
  industries: [INDUSTRIES.EDUCATION_CONSULTANCY],
  triggers: [{ event: "crm/lead.assigned" }],
  toolIds: ["get_lead", "propose_email"],
  outputKinds: ["draft_email"],
  maxSteps: 8,
  systemPrompt: () =>
    "You are the Follow-up Drafter agent for this education consultancy tenant. A lead was just assigned " +
    "to a counselor. Use get_lead to read the lead's details, then call propose_email exactly once with a " +
    "warm, concise, personalized first-outreach email (subject + body) the counselor can review and send. " +
    "You may only propose a draft for a human to review — you cannot send anything, change the lead, or " +
    "take any other action.",
};

registerAgentDefinition(followUpDrafterAgent);
