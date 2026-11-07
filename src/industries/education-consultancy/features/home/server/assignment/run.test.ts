import { beforeEach, describe, expect, it, vi } from "vitest";

const settingsRef = vi.hoisted(() => ({ value: { mode: "shadow", firstTouchPositions: ["lead-caller"] } as { mode: string; firstTouchPositions: string[] } }));
const existingRef = vi.hoisted(() => ({ value: null as { id: string } | null }));
const decideMock = vi.hoisted(() => vi.fn());
const assignMock = vi.hoisted(() => vi.fn());
const insertMock = vi.hoisted(() => vi.fn());
const updateMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/logger", () => ({ logger: { info: vi.fn(), error: vi.fn() } }));
vi.mock("@/lib/supabase/scoped", () => ({
  scopedClientForTenant: async () => ({
    from: () => ({
      select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: existingRef.value }) }) }),
      insert: (row: unknown) => { insertMock(row); return { select: () => ({ single: async () => ({ data: { id: "dec-1" }, error: null }) }) }; },
      update: (row: unknown) => { updateMock(row); return { eq: async () => ({ error: null }) }; },
    }),
  }),
}));
vi.mock("./settings", () => ({ loadAssignmentSettings: async () => settingsRef.value }));
vi.mock("./engine", () => ({ decideForLead: decideMock }));
vi.mock("./assign", () => ({ assignAsSmartAssignment: assignMock }));

const picked = { lead: { id: "l1", assigned_to: null, branch_id: "global" }, decision: { pickedUserId: "asha", branch: "unstaffed", why: "Asha: ...", candidates: [{ userId: "asha" }] } };

beforeEach(() => {
  settingsRef.value = { mode: "shadow", firstTouchPositions: ["lead-caller"] };
  existingRef.value = null;
  decideMock.mockReset().mockResolvedValue(picked);
  assignMock.mockReset();
  insertMock.mockClear();
  updateMock.mockClear();
});

describe("runSmartAssignment", () => {
  it("off: does nothing at all", async () => {
    settingsRef.value.mode = "off";
    const { runSmartAssignment } = await import("./run");
    expect(await runSmartAssignment("t", "l1")).toEqual({ status: "skipped", reason: "off" });
    expect(decideMock).not.toHaveBeenCalled();
  });

  it("shadow: stores the pick (candidates, why) and assigns nothing", async () => {
    const { runSmartAssignment } = await import("./run");
    const r = await runSmartAssignment("t", "l1");
    expect(r).toEqual({ status: "shadow", decisionId: "dec-1", pickedUserId: "asha" });
    expect(insertMock).toHaveBeenCalledWith(expect.objectContaining({ lead_id: "l1", mode: "shadow", picked_user_id: "asha", why: "Asha: ...", branch_basis: "unstaffed", prior_branch_id: "global" }));
    expect(assignMock).not.toHaveBeenCalled();
  });

  it("auto: stores the pick, assigns through assignAsSmartAssignment, then marks it applied as the owner", async () => {
    settingsRef.value.mode = "auto";
    assignMock.mockResolvedValue({ kind: "assigned", ownerId: "owner-1" });
    const { runSmartAssignment } = await import("./run");
    const r = await runSmartAssignment("t", "l1");
    expect(r.status).toBe("assigned");
    expect(assignMock).toHaveBeenCalledWith({ tenantId: "t", leadId: "l1", targetUserId: "asha", decisionId: "dec-1" });
    expect(updateMock).toHaveBeenCalledWith({ applied: true, acted_as_user_id: "owner-1" });
  });

  it("idempotent: a lead that already has a decision is skipped (a retry or a double event)", async () => {
    existingRef.value = { id: "dec-0" };
    const { runSmartAssignment } = await import("./run");
    expect(await runSmartAssignment("t", "l1")).toEqual({ status: "skipped", reason: "already_decided" });
    expect(decideMock).not.toHaveBeenCalled();
    expect(insertMock).not.toHaveBeenCalled();
  });

  it("a lead someone assigned meanwhile is skipped before any decision is stored", async () => {
    decideMock.mockResolvedValue({ ...picked, lead: { id: "l1", assigned_to: "human" } });
    const { runSmartAssignment } = await import("./run");
    expect(await runSmartAssignment("t", "l1")).toEqual({ status: "skipped", reason: "already_assigned" });
    expect(insertMock).not.toHaveBeenCalled();
  });

  it("auto, but assigned between the pick and the write: recorded as skipped (already assigned), never applied", async () => {
    settingsRef.value.mode = "auto";
    assignMock.mockResolvedValue({ kind: "skipped", reason: "already_assigned" });
    const { runSmartAssignment } = await import("./run");
    expect(await runSmartAssignment("t", "l1")).toEqual({ status: "skipped", reason: "already_assigned" });
    expect(updateMock).not.toHaveBeenCalled();
  });

  it("nobody could take it: the decision IS stored with no pick (why + each person's filter), nothing is assigned, the lead stays unassigned", async () => {
    settingsRef.value.mode = "auto";
    decideMock.mockResolvedValue({ ...picked, decision: { pickedUserId: null, branch: "unstaffed", why: "No one can take it now (2 suspended), so it stays unassigned for a manager.", candidates: [{ userId: "x", excluded: "inactive" }] } });
    const { runSmartAssignment } = await import("./run");
    expect(await runSmartAssignment("t", "l1")).toEqual({ status: "skipped", reason: "no_candidate" });
    expect(insertMock).toHaveBeenCalledWith(expect.objectContaining({ lead_id: "l1", picked_user_id: null, branch_basis: "unstaffed", why: expect.stringContaining("stays unassigned") }));
    expect(assignMock).not.toHaveBeenCalled();
    expect(updateMock).not.toHaveBeenCalled();
  });
});
