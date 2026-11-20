import { describe, expect, it } from "vitest";
import { agentDraftsRow, AGENT_REVIEW_HREF } from "./agent-drafts";

const S = { count: 3, agentName: "Follow-up agent", reviewHref: AGENT_REVIEW_HREF };

describe("agentDraftsRow: 'N drafts from Orca to approve' (H5 row 4)", () => {
  it("shows the count, the agent chip, who it is for, and Review N to the existing agent approvals page", () => {
    const r = agentDraftsRow(S, "Pokhara", true);
    expect(r).toMatchObject({ key: "agent_drafts", icon: "sparkle", title: "3 drafts from Orca to approve", chip: { text: "Follow-up agent" } });
    expect(r?.why).toBe("Written for Pokhara · nothing is sent until someone approves");
    expect(r?.actions).toEqual([{ type: "link", label: "Review 3", href: "/orca/review" }]);
  });
  it("singular for one", () => {
    expect(agentDraftsRow({ ...S, count: 1 }, "all branches", true)?.title).toBe("1 draft from Orca to approve");
  });
  it("no drafts in scope: no row at all (no empty state); AI off passes null", () => {
    expect(agentDraftsRow(null, "Pokhara", true)).toBeNull();
    expect(agentDraftsRow({ ...S, count: 0 }, "Pokhara", true)).toBeNull();
  });
  it("someone who can't open the review page sees who reviews, never a dead button", () => {
    expect(agentDraftsRow(S, "Pokhara", false)?.actions).toEqual([{ type: "note", label: "The owner reviews these" }]);
  });
});
