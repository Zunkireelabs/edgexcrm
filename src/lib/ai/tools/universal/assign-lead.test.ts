import { describe, it, expect, vi, beforeEach } from "vitest";
import type { AuthContext } from "@/lib/api/auth";
import type { ToolContext } from "../types";
import { assignLeadTool } from "./assign-lead";

const { applyLeadPatchMock } = vi.hoisted(() => ({ applyLeadPatchMock: vi.fn() }));
vi.mock("@/lib/leads/apply-lead-patch", () => ({ applyLeadPatch: applyLeadPatchMock }));

const NIL_UUID = "00000000-0000-0000-0000-000000000000";
const LEAD_ID = "10000000-0000-4000-8000-000000000001";
const ASSIGNEE_ID = "20000000-0000-4000-8000-000000000002";

function fixtureAuth(): AuthContext {
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
  };
}

function fixtureCtx(): ToolContext {
  return {
    auth: fixtureAuth(),
    db: {} as ToolContext["db"],
    logger: { child: () => ({ info: vi.fn(), error: vi.fn() }) } as unknown as ToolContext["logger"],
    runId: "run-1",
    conversationId: "conv-1",
  };
}

beforeEach(() => {
  applyLeadPatchMock.mockReset();
});

describe("assign_lead — input schema", () => {
  it("requires both leadId and assigneeId", () => {
    expect(assignLeadTool.inputSchema.safeParse({}).success).toBe(false);
    expect(assignLeadTool.inputSchema.safeParse({ leadId: LEAD_ID }).success).toBe(false);
    expect(assignLeadTool.inputSchema.safeParse({ assigneeId: ASSIGNEE_ID }).success).toBe(false);
  });

  it("accepts a valid leadId + assigneeId (self-assign allowed)", () => {
    const result = assignLeadTool.inputSchema.safeParse({ leadId: LEAD_ID, assigneeId: LEAD_ID });
    expect(result.success).toBe(true);
  });

  it("treats a NIL-uuid assigneeId as missing (required validation error)", () => {
    const result = assignLeadTool.inputSchema.safeParse({ leadId: LEAD_ID, assigneeId: NIL_UUID });
    expect(result.success).toBe(false);
  });
});

describe("assign_lead — outcome mapping", () => {
  const input = { leadId: LEAD_ID, assigneeId: ASSIGNEE_ID } as never;

  it("calls applyLeadPatch with { assigned_to: assigneeId }", async () => {
    applyLeadPatchMock.mockResolvedValue({ kind: "ok", lead: {}, changes: {}, previousValues: {} });
    const ctx = fixtureCtx();
    await assignLeadTool.execute(ctx, input);
    expect(applyLeadPatchMock).toHaveBeenCalledWith(ctx.auth, LEAD_ID, { assigned_to: ASSIGNEE_ID }, expect.any(Object));
  });

  it("not_found -> \"Lead not found.\"", async () => {
    applyLeadPatchMock.mockResolvedValue({ kind: "not_found" });
    const result = await assignLeadTool.execute(fixtureCtx(), input);
    expect(result).toEqual({ error: "Lead not found." });
  });

  it("forbidden without a message uses a generic refusal", async () => {
    applyLeadPatchMock.mockResolvedValue({ kind: "forbidden" });
    const result = await assignLeadTool.execute(fixtureCtx(), input);
    expect(result).toEqual({ error: expect.stringContaining("don't have permission") });
  });

  it("validation joins field errors", async () => {
    applyLeadPatchMock.mockResolvedValue({
      kind: "validation",
      errors: { assigned_to: ["Assigned user is not a member of this tenant"] },
    });
    const result = await assignLeadTool.execute(fixtureCtx(), input);
    expect(result).toEqual({ error: "assigned_to: Assigned user is not a member of this tenant" });
  });

  it("db_error -> a retry-suggesting error", async () => {
    applyLeadPatchMock.mockResolvedValue({ kind: "db_error", error: { message: "boom" } });
    const result = await assignLeadTool.execute(fixtureCtx(), input);
    expect(result).toEqual({ error: expect.stringContaining("Try again") });
  });

  it("ok returns leadId/assignedTo/previous (undo-allowlisted)/note", async () => {
    applyLeadPatchMock.mockResolvedValue({
      kind: "ok",
      lead: { id: LEAD_ID },
      changes: {},
      previousValues: { assigned_to: "prior-user", lead_type: "lead" },
    });
    const result = await assignLeadTool.execute(fixtureCtx(), input);
    expect(result).toEqual({
      leadId: LEAD_ID,
      assignedTo: ASSIGNEE_ID,
      previous: { assigned_to: "prior-user" },
      note: "Lead assigned.",
    });
  });
});
