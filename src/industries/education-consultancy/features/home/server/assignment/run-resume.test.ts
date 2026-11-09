import { beforeEach, describe, expect, it, vi } from "vitest";

// Click-through round 5, N: a retry finishes an unapplied auto decision.
type Row = { id: string; mode: string; applied: boolean; outcome: string | null; picked_user_id: string | null };
const refs = vi.hoisted(() => ({ existing: null as unknown, settings: { mode: "auto", firstTouchPositions: [] as string[] }, updateError: null as { message: string } | null, lead: null as unknown }));
const decideMock = vi.hoisted(() => vi.fn());
const assignMock = vi.hoisted(() => vi.fn());
const ownerMock = vi.hoisted(() => vi.fn());
const insertMock = vi.hoisted(() => vi.fn());
const updateMock = vi.hoisted(() => vi.fn());

vi.mock("@/lib/logger", () => ({ logger: { info: vi.fn(), error: vi.fn() } }));
vi.mock("@/lib/supabase/scoped", () => ({
  scopedClientForTenant: async () => ({
    from: () => ({
      select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: refs.existing, error: null }) }) }),
      insert: (row: unknown) => { insertMock(row); return { select: () => ({ single: async () => ({ data: { id: "dec-new" }, error: null }) }) }; },
      update: (row: unknown) => { updateMock(row); return { eq: async () => ({ error: refs.updateError }) }; },
    }),
  }),
}));
vi.mock("./settings", () => ({ loadAssignmentSettings: async () => refs.settings }));
vi.mock("./engine", () => ({ decideForLead: decideMock, loadLeadForAssignment: async () => refs.lead }));
vi.mock("./assign", () => ({ assignAsSmartAssignment: assignMock, findSystemOwner: ownerMock }));

import { runSmartAssignment } from "./run";

const open = (o: Partial<Row> = {}): Row => ({ id: "dec-1", mode: "auto", applied: false, outcome: null, picked_user_id: "asha", ...o });
const unassigned = { id: "l1", assigned_to: null };

beforeEach(() => {
  refs.existing = open();
  refs.settings = { mode: "auto", firstTouchPositions: [] };
  refs.updateError = null;
  refs.lead = unassigned;
  decideMock.mockReset();
  assignMock.mockReset().mockResolvedValue({ kind: "assigned", ownerId: "owner-1" });
  ownerMock.mockReset().mockResolvedValue("owner-1");
  insertMock.mockClear();
  updateMock.mockClear();
});

describe("resuming an unapplied auto decision", () => {
  it("assigns the stored pick with the row's id, decides nothing new, and marks it applied", async () => {
    expect(await runSmartAssignment("t", "l1")).toEqual({ status: "assigned", decisionId: "dec-1", pickedUserId: "asha" });
    expect(assignMock).toHaveBeenCalledWith({ tenantId: "t", leadId: "l1", targetUserId: "asha", decisionId: "dec-1" });
    expect(decideMock).not.toHaveBeenCalled();
    expect(insertMock).not.toHaveBeenCalled();
    expect(updateMock).toHaveBeenCalledWith({ applied: true, acted_as_user_id: "owner-1" });
  });

  it.each([
    ["undone", open({ outcome: "undone" })],
    ["matched", open({ outcome: "matched" })],
    ["overridden", open({ outcome: "overridden" })],
    ["already applied", open({ applied: true })],
    ["a shadow row", open({ mode: "shadow" })],
    ["no pick", open({ picked_user_id: null })],
  ])("%s never resumes", async (_name, row) => {
    refs.existing = row;
    expect(await runSmartAssignment("t", "l1")).toEqual({ status: "skipped", reason: "already_decided" });
    expect(assignMock).not.toHaveBeenCalled();
    expect(updateMock).not.toHaveBeenCalled();
  });

  it("the tenant moved back to shadow: an old auto row does not resume", async () => {
    refs.settings = { mode: "shadow", firstTouchPositions: [] };
    expect(await runSmartAssignment("t", "l1")).toEqual({ status: "skipped", reason: "already_decided" });
    expect(assignMock).not.toHaveBeenCalled();
  });

  it("a person assigned the lead to someone else meanwhile: stays a skip, never applied", async () => {
    refs.lead = { id: "l1", assigned_to: "binod" };
    assignMock.mockResolvedValue({ kind: "skipped", reason: "already_assigned" });
    expect(await runSmartAssignment("t", "l1")).toEqual({ status: "skipped", reason: "already_assigned" });
    expect(updateMock).not.toHaveBeenCalled();
  });

  it("the assign landed but `applied` did not: the retry marks it applied without assigning again", async () => {
    refs.lead = { id: "l1", assigned_to: "asha" };
    expect(await runSmartAssignment("t", "l1")).toEqual({ status: "assigned", decisionId: "dec-1", pickedUserId: "asha" });
    expect(assignMock).not.toHaveBeenCalled();
    expect(ownerMock).toHaveBeenCalledWith("t", { strict: true });
    expect(updateMock).toHaveBeenCalledWith({ applied: true, acted_as_user_id: "owner-1" });
  });

  it("that same bookkeeping write failing throws, so Inngest tries again", async () => {
    refs.lead = { id: "l1", assigned_to: "asha" };
    refs.updateError = { message: "gateway" };
    await expect(runSmartAssignment("t", "l1")).rejects.toThrow(/applied update failed.*gateway/);
  });
});

describe("a failed assign retries, it does not read as a skip", () => {
  it("a `failed` result throws on a first run, after the decision is stored", async () => {
    refs.existing = null;
    decideMock.mockResolvedValue({ lead: { id: "l1", assigned_to: null, branch_id: null }, decision: { pickedUserId: "asha", branch: "x", why: "y", candidates: [] } });
    assignMock.mockResolvedValue({ kind: "skipped", reason: "failed" });
    await expect(runSmartAssignment("t", "l1")).rejects.toThrow(/assign failed/);
    expect(insertMock).toHaveBeenCalledTimes(1);
    expect(updateMock).not.toHaveBeenCalled();
  });
  it("a `failed` result throws on a resume too", async () => {
    assignMock.mockResolvedValue({ kind: "skipped", reason: "failed" });
    await expect(runSmartAssignment("t", "l1")).rejects.toThrow(/assign failed/);
  });
  it.each(["no_owner", "not_permitted", "lead_missing"])("%s stays a skip", async (reason) => {
    assignMock.mockResolvedValue({ kind: "skipped", reason });
    expect(await runSmartAssignment("t", "l1")).toEqual({ status: "skipped", reason });
  });
  it("a failed `applied` write after a good assign throws", async () => {
    refs.updateError = { message: "gateway" };
    await expect(runSmartAssignment("t", "l1")).rejects.toThrow(/applied update failed/);
  });
});
