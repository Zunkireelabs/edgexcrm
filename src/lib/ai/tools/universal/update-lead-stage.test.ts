import { describe, it, expect, vi, beforeEach } from "vitest";
import type { AuthContext } from "@/lib/api/auth";
import type { ScopedClient } from "@/lib/supabase/scoped";
import type { ToolContext } from "../types";
import { updateLeadStageTool } from "./update-lead-stage";

const { applyLeadPatchMock } = vi.hoisted(() => ({ applyLeadPatchMock: vi.fn() }));
vi.mock("@/lib/leads/apply-lead-patch", () => ({ applyLeadPatch: applyLeadPatchMock }));

const NIL_UUID = "00000000-0000-0000-0000-000000000000";
const LEAD_ID = "10000000-0000-4000-8000-000000000001";

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

function fakeDb(lists: Array<{ id: string; name: string; access: unknown }>) {
  return {
    from: (table: string) => {
      if (table !== "lead_lists") throw new Error(`unexpected table ${table}`);
      return { select: () => Promise.resolve({ data: lists, error: null }) };
    },
  } as unknown as ScopedClient;
}

function fixtureCtx(lists: Array<{ id: string; name: string; access: unknown }>, authOverrides: Partial<AuthContext> = {}): ToolContext {
  return {
    auth: fixtureAuth(authOverrides),
    db: fakeDb(lists),
    logger: { child: () => ({ info: vi.fn(), error: vi.fn() }) } as unknown as ToolContext["logger"],
    runId: "run-1",
    conversationId: "conv-1",
  };
}

const ACCESSIBLE = { mode: "all" };

beforeEach(() => {
  applyLeadPatchMock.mockReset();
});

describe("update_lead_stage — input schema", () => {
  it("treats a NIL-uuid leadId as missing (required validation error)", () => {
    const result = updateLeadStageTool.inputSchema.safeParse({ leadId: NIL_UUID, stageName: "Qualified" });
    expect(result.success).toBe(false);
  });

  it("rejects when both stageName and stageId are provided", () => {
    const result = updateLeadStageTool.inputSchema.safeParse({
      leadId: LEAD_ID,
      stageName: "Qualified",
      stageId: LEAD_ID,
    });
    expect(result.success).toBe(false);
  });

  it("rejects when neither stageName nor stageId is provided", () => {
    const result = updateLeadStageTool.inputSchema.safeParse({ leadId: LEAD_ID });
    expect(result.success).toBe(false);
  });

  it("accepts leadId + stageName alone", () => {
    const result = updateLeadStageTool.inputSchema.safeParse({ leadId: LEAD_ID, stageName: "Qualified" });
    expect(result.success).toBe(true);
  });

  it("treats a blank stageName as absent, so stageId alone still validates", () => {
    const result = updateLeadStageTool.inputSchema.safeParse({ leadId: LEAD_ID, stageName: "  ", stageId: LEAD_ID });
    expect(result.success).toBe(true);
  });
});

describe("update_lead_stage — stage resolution", () => {
  it("resolves stageName case-insensitively among accessible lists", async () => {
    applyLeadPatchMock.mockResolvedValue({ kind: "ok", lead: {}, changes: {}, previousValues: { list_id: "old-list" } });
    const ctx = fixtureCtx([{ id: "list-1", name: "Qualified", access: ACCESSIBLE }]);
    const result = await updateLeadStageTool.execute(ctx, { leadId: LEAD_ID, stageName: "qualified" } as never);
    expect(applyLeadPatchMock).toHaveBeenCalledWith(ctx.auth, LEAD_ID, { list_id: "list-1" }, expect.any(Object));
    expect(result).toMatchObject({ leadId: LEAD_ID, stage: "Qualified" });
  });

  it("returns an error listing accessible stage names when stageName doesn't match", async () => {
    const ctx = fixtureCtx([{ id: "list-1", name: "Qualified", access: ACCESSIBLE }, { id: "list-2", name: "Applications", access: ACCESSIBLE }]);
    const result = await updateLeadStageTool.execute(ctx, { leadId: LEAD_ID, stageName: "Nonexistent" } as never);
    expect(result).toMatchObject({ error: expect.stringContaining("Qualified") });
    expect((result as { error: string }).error).toContain("Applications");
    expect(applyLeadPatchMock).not.toHaveBeenCalled();
  });

  it("returns an error when stageName matches more than one accessible list", async () => {
    const ctx = fixtureCtx([
      { id: "list-1", name: "Interview", access: ACCESSIBLE },
      { id: "list-2", name: "interview", access: ACCESSIBLE },
    ]);
    const result = await updateLeadStageTool.execute(ctx, { leadId: LEAD_ID, stageName: "Interview" } as never);
    expect(result).toMatchObject({ error: expect.stringContaining("Multiple Stages") });
    expect(applyLeadPatchMock).not.toHaveBeenCalled();
  });

  it("does not leak an admin-only list not accessible to the caller", async () => {
    const ctx = fixtureCtx(
      [{ id: "list-1", name: "Admin Only", access: { mode: "allow", positionIds: ["other-pos"] } }],
      { permissions: { baseTier: "member", listAccess: "all" } as AuthContext["permissions"], positionId: "pos-1" },
    );
    const result = await updateLeadStageTool.execute(ctx, { leadId: LEAD_ID, stageName: "Admin Only" } as never);
    expect(result).toMatchObject({ error: expect.stringContaining("none accessible") });
  });

  it("resolves by stageId directly among accessible lists", async () => {
    applyLeadPatchMock.mockResolvedValue({ kind: "ok", lead: {}, changes: {}, previousValues: {} });
    const ctx = fixtureCtx([{ id: "list-1", name: "Qualified", access: ACCESSIBLE }]);
    await updateLeadStageTool.execute(ctx, { leadId: LEAD_ID, stageId: "list-1" } as never);
    expect(applyLeadPatchMock).toHaveBeenCalledWith(ctx.auth, LEAD_ID, { list_id: "list-1" }, expect.any(Object));
  });
});

describe("update_lead_stage — outcome mapping", () => {
  const ctx = () => fixtureCtx([{ id: "list-1", name: "Qualified", access: ACCESSIBLE }]);
  const input = { leadId: LEAD_ID, stageName: "Qualified" } as never;

  it("not_found -> \"Lead not found.\" (parity with get_lead — no existence oracle)", async () => {
    applyLeadPatchMock.mockResolvedValue({ kind: "not_found" });
    const result = await updateLeadStageTool.execute(ctx(), input);
    expect(result).toEqual({ error: "Lead not found." });
  });

  it("forbidden with a message surfaces that exact message", async () => {
    applyLeadPatchMock.mockResolvedValue({ kind: "forbidden", message: "First holder cannot revert this lead" });
    const result = await updateLeadStageTool.execute(ctx(), input);
    expect(result).toEqual({ error: "First holder cannot revert this lead" });
  });

  it("forbidden without a message uses a generic refusal", async () => {
    applyLeadPatchMock.mockResolvedValue({ kind: "forbidden" });
    const result = await updateLeadStageTool.execute(ctx(), input);
    expect(result).toEqual({ error: expect.stringContaining("don't have permission") });
  });

  it("validation joins field errors so they reach the model verbatim", async () => {
    applyLeadPatchMock.mockResolvedValue({
      kind: "validation",
      errors: { academic: ["Add the student's highest qualification (%/GPA) before moving to Prospects."] },
    });
    const result = await updateLeadStageTool.execute(ctx(), input);
    expect(result).toEqual({ error: "academic: Add the student's highest qualification (%/GPA) before moving to Prospects." });
  });

  it("ok returns leadId/stage/previous (undo-allowlisted)/note", async () => {
    applyLeadPatchMock.mockResolvedValue({
      kind: "ok",
      lead: { id: LEAD_ID },
      changes: {},
      previousValues: { list_id: "old-list", status: "old-status", stage_id: "old-stage", pipeline_id: "old-pipe", lead_type: "lead" },
    });
    const result = await updateLeadStageTool.execute(ctx(), input);
    expect(result).toEqual({
      leadId: LEAD_ID,
      stage: "Qualified",
      previous: { list_id: "old-list", status: "old-status", stage_id: "old-stage", pipeline_id: "old-pipe" },
      note: "Moved to Qualified.",
    });
  });
});
