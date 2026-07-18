import { describe, it, expect, vi, beforeEach } from "vitest";
import type { AuthContext } from "@/lib/api/auth";
import type { ScopedClient } from "@/lib/supabase/scoped";
import type { ToolContext } from "../types";
import { undoLeadActionTool } from "./undo-lead-action";

const { applyLeadPatchMock } = vi.hoisted(() => ({ applyLeadPatchMock: vi.fn() }));
vi.mock("@/lib/leads/apply-lead-patch", () => ({ applyLeadPatch: applyLeadPatchMock }));

const LEAD_ID = "10000000-0000-4000-8000-000000000001";
const ACTION_ID = "30000000-0000-4000-8000-000000000003";

function fixtureAuth(overrides: Partial<AuthContext> = {}): AuthContext {
  return {
    userId: "user-1",
    email: "u@example.com",
    tenantId: "tenant-1",
    role: "owner",
    industryId: "education_consultancy",
    positionId: null,
    positionSlug: null,
    branchId: null,
    branchMemberIds: [],
    permissions: { baseTier: "owner" } as AuthContext["permissions"],
    plan: "free",
    entitlements: {} as AuthContext["entitlements"],
    ...overrides,
  };
}

/** Scripted fake ai_write_actions client: each `.from()` call resolves the next queued response, in order. */
function fakeDb(responses: Array<{ data: unknown }>) {
  let i = 0;
  const chain = {
    select: () => chain,
    eq: () => chain,
    in: () => chain,
    order: () => chain,
    limit: () => chain,
    maybeSingle: async () => {
      const r = responses[i] ?? { data: null };
      i += 1;
      return { data: r.data, error: null };
    },
  };
  return { from: () => chain } as unknown as ScopedClient;
}

function fixtureCtx(db: ScopedClient, authOverrides: Partial<AuthContext> = {}): ToolContext {
  return {
    auth: fixtureAuth(authOverrides),
    db,
    logger: { child: () => ({ info: vi.fn(), error: vi.fn() }) } as unknown as ToolContext["logger"],
    runId: "run-1",
    conversationId: "conv-1",
  };
}

beforeEach(() => {
  applyLeadPatchMock.mockReset();
});

describe("undo_lead_action — input schema", () => {
  it("actionId is optional", () => {
    expect(undoLeadActionTool.inputSchema.safeParse({}).success).toBe(true);
  });

  it("a NIL-uuid actionId is treated as omitted", () => {
    const result = undoLeadActionTool.inputSchema.safeParse({ actionId: "00000000-0000-0000-0000-000000000000" });
    expect(result.success).toBe(true);
    expect(result.success && result.data.actionId).toBeUndefined();
  });
});

describe("undo_lead_action — guards", () => {
  it("no actionId and no recent undoable action -> a friendly 'nothing to undo' error", async () => {
    const db = fakeDb([{ data: null }]);
    const result = await undoLeadActionTool.execute(fixtureCtx(db), {} as never);
    expect(result).toEqual({ error: "You have no recent action to undo." });
    expect(applyLeadPatchMock).not.toHaveBeenCalled();
  });

  it("an explicit actionId that doesn't exist -> 'No such action found.'", async () => {
    const db = fakeDb([{ data: null }]);
    const result = await undoLeadActionTool.execute(fixtureCtx(db), { actionId: ACTION_ID } as never);
    expect(result).toEqual({ error: "No such action found." });
  });

  it("cannot undo another user's action", async () => {
    const db = fakeDb([
      { data: { id: ACTION_ID, tool_id: "update_lead_stage", user_id: "someone-else", status: "executed", input: { leadId: LEAD_ID }, result: { previous: { list_id: "old" } } } },
    ]);
    const result = await undoLeadActionTool.execute(fixtureCtx(db), { actionId: ACTION_ID } as never);
    expect(result).toEqual({ error: "You can only undo your own actions." });
  });

  it("cannot undo a tool outside the undoable allowlist", async () => {
    const db = fakeDb([
      { data: { id: ACTION_ID, tool_id: "create_task", user_id: "user-1", status: "executed", input: {}, result: {} } },
    ]);
    const result = await undoLeadActionTool.execute(fixtureCtx(db), { actionId: ACTION_ID } as never);
    expect(result).toEqual({ error: 'Action "create_task" cannot be undone.' });
  });

  it("already-undone action is refused", async () => {
    const db = fakeDb([
      { data: { id: ACTION_ID, tool_id: "assign_lead", user_id: "user-1", status: "executed", input: { leadId: LEAD_ID }, result: { previous: { assigned_to: "old" } } } },
      { data: { id: "undo-row-1" } }, // existingUndo lookup finds a prior undo
    ]);
    const result = await undoLeadActionTool.execute(fixtureCtx(db), { actionId: ACTION_ID } as never);
    expect(result).toEqual({ error: "This action was already undone." });
    expect(applyLeadPatchMock).not.toHaveBeenCalled();
  });

  it("no previous snapshot recorded -> cannot undo", async () => {
    const db = fakeDb([
      { data: { id: ACTION_ID, tool_id: "assign_lead", user_id: "user-1", status: "executed", input: { leadId: LEAD_ID }, result: {} } },
      { data: null },
    ]);
    const result = await undoLeadActionTool.execute(fixtureCtx(db), { actionId: ACTION_ID } as never);
    expect(result).toEqual({ error: "No prior state was recorded for this action — cannot undo." });
  });

  it("previous snapshot with no allowlisted fields -> cannot undo", async () => {
    const db = fakeDb([
      { data: { id: ACTION_ID, tool_id: "assign_lead", user_id: "user-1", status: "executed", input: { leadId: LEAD_ID }, result: { previous: { owner_id: "x" } } } },
      { data: null },
    ]);
    const result = await undoLeadActionTool.execute(fixtureCtx(db), { actionId: ACTION_ID } as never);
    expect(result).toEqual({ error: "No prior state was recorded for this action — cannot undo." });
  });

  it("missing leadId on the target action's input -> cannot determine which lead", async () => {
    const db = fakeDb([
      { data: { id: ACTION_ID, tool_id: "assign_lead", user_id: "user-1", status: "executed", input: {}, result: { previous: { assigned_to: "old" } } } },
      { data: null },
    ]);
    const result = await undoLeadActionTool.execute(fixtureCtx(db), { actionId: ACTION_ID } as never);
    expect(result).toEqual({ error: "Could not determine which lead to restore." });
  });
});

describe("undo_lead_action — happy path", () => {
  it("restores only the allowlisted fields from the previous snapshot and returns undoOf", async () => {
    const db = fakeDb([
      {
        data: {
          id: ACTION_ID,
          tool_id: "update_lead_stage",
          user_id: "user-1",
          status: "executed",
          input: { leadId: LEAD_ID, stageName: "Qualified" },
          result: {
            previous: { list_id: "old-list", status: "old-status", stage_id: "old-stage", pipeline_id: "old-pipe", lead_type: "lead" },
          },
        },
      },
      { data: null }, // no existing undo
    ]);
    applyLeadPatchMock.mockResolvedValue({ kind: "ok", lead: { id: LEAD_ID }, changes: {}, previousValues: {} });

    const ctx = fixtureCtx(db);
    const result = await undoLeadActionTool.execute(ctx, { actionId: ACTION_ID } as never);

    expect(applyLeadPatchMock).toHaveBeenCalledWith(
      ctx.auth,
      LEAD_ID,
      { list_id: "old-list", status: "old-status", stage_id: "old-stage", pipeline_id: "old-pipe" },
      expect.any(Object),
    );
    expect(result).toEqual({
      leadId: LEAD_ID,
      undoOf: ACTION_ID,
      restored: { list_id: "old-list", status: "old-status", stage_id: "old-stage", pipeline_id: "old-pipe" },
      note: "Action undone.",
    });
  });

  it("omitting actionId resolves the caller's most recent executed update_lead_stage/assign_lead action", async () => {
    const db = fakeDb([
      {
        data: {
          id: ACTION_ID,
          tool_id: "assign_lead",
          user_id: "user-1",
          status: "executed",
          input: { leadId: LEAD_ID },
          result: { previous: { assigned_to: "prior-user" } },
        },
      },
      { data: null },
    ]);
    applyLeadPatchMock.mockResolvedValue({ kind: "ok", lead: {}, changes: {}, previousValues: {} });

    const result = await undoLeadActionTool.execute(fixtureCtx(db), {} as never);
    expect(result).toMatchObject({ leadId: LEAD_ID, undoOf: ACTION_ID });
  });

  it("obeys governance: applyLeadPatch's forbidden outcome surfaces as a refusal, not a bypass", async () => {
    const db = fakeDb([
      {
        data: {
          id: ACTION_ID,
          tool_id: "update_lead_stage",
          user_id: "user-1",
          status: "executed",
          input: { leadId: LEAD_ID },
          result: { previous: { list_id: "old-list" } },
        },
      },
      { data: null },
    ]);
    applyLeadPatchMock.mockResolvedValue({ kind: "forbidden", message: "First holder cannot revert this lead" });

    const result = await undoLeadActionTool.execute(fixtureCtx(db), { actionId: ACTION_ID } as never);
    expect(result).toEqual({ error: "First holder cannot revert this lead" });
  });
});
