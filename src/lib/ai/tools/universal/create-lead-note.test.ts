import { describe, it, expect, vi, beforeEach } from "vitest";
import type { z } from "zod";
import type { AuthContext } from "@/lib/api/auth";
import type { ToolContext } from "../types";
import { createLeadNoteTool } from "./create-lead-note";

const { createLeadNoteMock } = vi.hoisted(() => ({ createLeadNoteMock: vi.fn() }));
vi.mock("@/lib/leads/create-lead-note", () => ({ createLeadNote: createLeadNoteMock }));

const LEAD_ID = "10000000-0000-4000-8000-000000000001";
const NIL_UUID = "00000000-0000-0000-0000-000000000000";

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

function fixtureCtx(overrides: Partial<ToolContext> = {}): ToolContext {
  return {
    auth: fixtureAuth(),
    db: {} as ToolContext["db"],
    logger: { child: () => ({ info: vi.fn(), error: vi.fn() }) } as unknown as ToolContext["logger"],
    runId: "run-1",
    conversationId: "conv-1",
    toolCallId: "tc-1",
    ...overrides,
  };
}

beforeEach(() => {
  createLeadNoteMock.mockReset();
});

describe("create_lead_note — input schema", () => {
  it("requires leadId and content", () => {
    expect(createLeadNoteTool.inputSchema.safeParse({}).success).toBe(false);
    expect(createLeadNoteTool.inputSchema.safeParse({ leadId: LEAD_ID }).success).toBe(false);
    expect(createLeadNoteTool.inputSchema.safeParse({ content: "hi" }).success).toBe(false);
  });

  it("treats a NIL-uuid leadId as missing (required validation error)", () => {
    const result = createLeadNoteTool.inputSchema.safeParse({ leadId: NIL_UUID, content: "hi" });
    expect(result.success).toBe(false);
  });

  it("rejects empty/whitespace-only content", () => {
    const result = createLeadNoteTool.inputSchema.safeParse({ leadId: LEAD_ID, content: "   " });
    expect(result.success).toBe(false);
  });

  it("rejects content over 5000 characters", () => {
    const result = createLeadNoteTool.inputSchema.safeParse({ leadId: LEAD_ID, content: "x".repeat(5001) });
    expect(result.success).toBe(false);
  });

  it("accepts content at exactly 5000 characters", () => {
    const result = createLeadNoteTool.inputSchema.safeParse({ leadId: LEAD_ID, content: "x".repeat(5000) });
    expect(result.success).toBe(true);
  });

  it("has no mentionedUserIds field — the model cannot invent one", () => {
    const schema = createLeadNoteTool.inputSchema as unknown as z.ZodObject<z.ZodRawShape>;
    expect("mentionedUserIds" in schema.shape).toBe(false);
  });
});

describe("create_lead_note — execute", () => {
  const input = { leadId: LEAD_ID, content: "Called the lead, interested in Fall intake." } as never;

  it("calls createLeadNote with createdVia:'ai_assistant' and ctx.toolCallId", async () => {
    createLeadNoteMock.mockResolvedValue({ kind: "ok", note: { id: "note-1" } });
    const ctx = fixtureCtx();
    await createLeadNoteTool.execute(ctx, input);
    expect(createLeadNoteMock).toHaveBeenCalledWith(
      ctx.auth,
      LEAD_ID,
      { content: "Called the lead, interested in Fall intake.", createdVia: "ai_assistant", aiToolCallId: "tc-1" },
      { requestId: "run-1" },
    );
  });

  it("falls back to null aiToolCallId if ctx.toolCallId is somehow unset", async () => {
    createLeadNoteMock.mockResolvedValue({ kind: "ok", note: { id: "note-1" } });
    await createLeadNoteTool.execute(fixtureCtx({ toolCallId: undefined }), input);
    const [, , body] = createLeadNoteMock.mock.calls[0];
    expect(body.aiToolCallId).toBeNull();
  });

  it('not_found -> "Lead not found." (parity with get_lead/4B — no existence oracle)', async () => {
    createLeadNoteMock.mockResolvedValue({ kind: "not_found" });
    const result = await createLeadNoteTool.execute(fixtureCtx(), input);
    expect(result).toEqual({ error: "Lead not found." });
  });

  it("validation joins field errors", async () => {
    createLeadNoteMock.mockResolvedValue({
      kind: "validation",
      errors: { content: ["Note content is required"] },
    });
    const result = await createLeadNoteTool.execute(fixtureCtx(), input);
    expect(result).toEqual({ error: "content: Note content is required" });
  });

  it("db_error -> a retry-suggesting error", async () => {
    createLeadNoteMock.mockResolvedValue({ kind: "db_error", error: { message: "boom" } });
    const result = await createLeadNoteTool.execute(fixtureCtx(), input);
    expect(result).toEqual({ error: expect.stringContaining("Try again") });
  });

  it("ok returns noteId/leadId/note marking it AI-written", async () => {
    createLeadNoteMock.mockResolvedValue({ kind: "ok", note: { id: "note-42" } });
    const result = await createLeadNoteTool.execute(fixtureCtx(), input);
    expect(result).toEqual({
      noteId: "note-42",
      leadId: LEAD_ID,
      note: "Note added to the lead's timeline, marked as AI-written.",
    });
  });
});
