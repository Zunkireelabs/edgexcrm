import { describe, it, expect } from "vitest";
import { leadWorkGates } from "./work-gates";
import { buildStageCardModel, type StageCardInput } from "./stage-card-model";
import type { LeadList } from "@/types/database";

const mk = (slug: string, name: string, sort_order: number): LeadList =>
  ({ id: slug, tenant_id: "t", name, slug, sort_order, is_system: false, is_archive: false, is_intake: false, color: null, access: { mode: "all" }, pipeline_id: null, funnel_key: null, created_at: "", updated_at: "" }) as LeadList;
const LISTS = [mk("qualified", "Qualified", 1), mk("prospects", "Prospects", 2), mk("applications", "Applications", 3)];
const model = (canWork: boolean) => buildStageCardModel({
  isOtherContact: false, activeLists: LISTS, accessibleLists: LISTS, currentListId: "prospects", isArchived: false,
  canMoveWithoutChain: true, revertTargetUserId: "u1", canWork, hasQualification: true,
  readiness: { ready: true, missing: [] }, consentEnabled: false, consentSigned: false, feeStatus: null, feeAmount: null,
} as StageCardInput);

const base = { isAdmin: false, leadScope: "own" as const, canEdit: true, userId: "collab", assignedTo: "someone-else" };

describe("lead work gates", () => {
  it("a non-assignee collaborator: Status editable, but no stage moves and no Archive", () => {
    const g = leadWorkGates({ ...base, isEditor: true });
    expect(g).toEqual({ canWork: false, canStatus: true });
    const m = model(g.canWork);
    expect(m.main.enabled).toBe(false);
    expect(m.footer.moveTo).toBe(false);
    expect(m.footer.archive).toBe(false);
  });
  it("the assignee has both", () => {
    const g = leadWorkGates({ ...base, userId: "me", assignedTo: "me", isEditor: true });
    expect(g).toEqual({ canWork: true, canStatus: true });
    expect(model(g.canWork).footer.archive).toBe(true);
  });
  it("a viewer who is nobody on the lead has neither; admin and branch manager have both", () => {
    expect(leadWorkGates({ ...base, isEditor: false })).toEqual({ canWork: false, canStatus: false });
    expect(leadWorkGates({ ...base, isAdmin: true, isEditor: true })).toEqual({ canWork: true, canStatus: true });
    expect(leadWorkGates({ ...base, leadScope: "team", isEditor: false })).toEqual({ canWork: true, canStatus: true });
  });
});
