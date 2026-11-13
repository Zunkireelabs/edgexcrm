import type { NeedsYouRow } from "./needs-you";

export interface AgentDraftSummary {
  /** Proposed message drafts (agent_outputs.kind = draft_email, status = proposed) in the viewer's scope. */
  count: number;
  /** The agent that wrote the most of them ("Follow-up agent"). */
  agentName: string;
  /** Where "Review N" goes: the existing agent approvals page. */
  reviewHref: string;
}

/** The existing agent approvals page, and the one place a draft is approved (the approval gate is unchanged). */
export const AGENT_REVIEW_HREF = "/orca/review";

/**
 * H5 row 4: "N drafts from Orca to approve". Only with at least one proposed message draft in scope (the caller passes null
 * otherwise, and AI off passes null): there is no empty version. Approving uses the existing approval gate, so a person who can't
 * open the review page (it is owner-only today) sees the row with who reviews them, not a dead button.
 */
export function agentDraftsRow(s: AgentDraftSummary | null, scopeLabel: string, canReview: boolean): NeedsYouRow | null {
  if (!s || s.count < 1) return null;
  return {
    key: "agent_drafts",
    tone: "neutral",
    icon: "sparkle",
    title: `${s.count} ${s.count === 1 ? "draft" : "drafts"} from Orca to approve`,
    chip: { text: s.agentName, tone: "neutral" },
    why: `Written for ${scopeLabel} \u00B7 nothing is sent until someone approves`,
    actions: canReview ? [{ type: "link", label: `Review ${s.count}`, href: s.reviewHref }] : [{ type: "note", label: "The owner reviews these" }],
  };
}
