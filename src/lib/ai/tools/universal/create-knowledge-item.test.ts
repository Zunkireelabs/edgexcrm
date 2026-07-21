import { describe, it, expect, vi, beforeEach } from "vitest";
import type { AuthContext } from "@/lib/api/auth";
import type { ToolContext } from "../types";
import type { ScopedClient } from "@/lib/supabase/scoped";
import { createKnowledgeItemTool } from "./create-knowledge-item";

const { isIngestionEnabledMock, inngestSendMock, createAuditLogMock, emitEventMock } = vi.hoisted(() => ({
  isIngestionEnabledMock: vi.fn(() => false),
  inngestSendMock: vi.fn(async () => ({})),
  createAuditLogMock: vi.fn(async () => {}),
  emitEventMock: vi.fn(async () => "event-1"),
}));

vi.mock("@/lib/ai/flag", () => ({ isIngestionEnabled: isIngestionEnabledMock }));
vi.mock("@/lib/ai/ingestion/inngest", () => ({ inngest: { send: inngestSendMock } }));
vi.mock("@/lib/api/audit", () => ({ createAuditLog: createAuditLogMock, emitEvent: emitEventMock }));

const KB_ID = "10000000-0000-4000-8000-000000000001";
const NIL_UUID = "00000000-0000-0000-0000-000000000000";

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

interface FakeDbOpts {
  kbExists?: boolean;
  kbNames?: string[];
  insertError?: { message: string } | null;
}

function makeFakeDb(opts: FakeDbOpts) {
  const inserted: Record<string, unknown>[] = [];

  const db = {
    from: (table: string) => {
      if (table === "knowledge_bases") {
        const b = {
          select: () => b,
          eq: () => b,
          order: () => b,
          maybeSingle: async () => ({ data: opts.kbExists ? { id: KB_ID } : null, error: null }),
          then: (resolve: (v: { data: unknown; error: unknown }) => void) => {
            resolve({ data: (opts.kbNames ?? []).map((name) => ({ name })), error: null });
          },
        };
        return b;
      }
      if (table === "knowledge_base_items") {
        let insertRow: Record<string, unknown> = {};
        const b = {
          insert: (row: Record<string, unknown>) => {
            insertRow = row;
            return b;
          },
          select: () => b,
          single: async () => {
            if (opts.insertError) return { data: null, error: opts.insertError };
            const created = { id: "item-1", ...insertRow };
            inserted.push(created);
            return { data: created, error: null };
          },
        };
        return b;
      }
      throw new Error(`unexpected table ${table}`);
    },
  } as unknown as ScopedClient;

  return { db, inserted };
}

function fixtureCtx(db: ScopedClient, overrides: Partial<ToolContext> = {}): ToolContext {
  return {
    db,
    auth: fixtureAuth(),
    logger: { child: () => ({ info: vi.fn(), error: vi.fn() }) } as unknown as ToolContext["logger"],
    runId: "run-1",
    conversationId: "conv-1",
    toolCallId: "tc-1",
    ...overrides,
  };
}

beforeEach(() => {
  isIngestionEnabledMock.mockReset().mockReturnValue(false);
  inngestSendMock.mockReset().mockResolvedValue({});
  createAuditLogMock.mockReset();
  emitEventMock.mockReset();
});

describe("create_knowledge_item — input schema", () => {
  it("requires knowledgeBaseId, title, content", () => {
    expect(createKnowledgeItemTool.inputSchema.safeParse({}).success).toBe(false);
    expect(
      createKnowledgeItemTool.inputSchema.safeParse({ knowledgeBaseId: KB_ID, title: "t" }).success,
    ).toBe(false);
  });

  it("treats a NIL-uuid knowledgeBaseId as missing", () => {
    const result = createKnowledgeItemTool.inputSchema.safeParse({
      knowledgeBaseId: NIL_UUID,
      title: "t",
      content: "c",
    });
    expect(result.success).toBe(false);
  });

  it("rejects title over 200 chars and content over 10000 chars", () => {
    expect(
      createKnowledgeItemTool.inputSchema.safeParse({ knowledgeBaseId: KB_ID, title: "x".repeat(201), content: "c" })
        .success,
    ).toBe(false);
    expect(
      createKnowledgeItemTool.inputSchema.safeParse({ knowledgeBaseId: KB_ID, title: "t", content: "x".repeat(10001) })
        .success,
    ).toBe(false);
  });
});

describe("create_knowledge_item — execute", () => {
  const input = { knowledgeBaseId: KB_ID, title: "Q3 pricing notes", content: "Discount cap is 15%." } as never;

  it("refuses a non-admin caller before touching the DB", async () => {
    const { db } = makeFakeDb({ kbExists: true });
    const ctx = fixtureCtx(db, { auth: fixtureAuth({ role: "counselor" }) });
    const result = await createKnowledgeItemTool.execute(ctx, input);
    expect(result).toEqual({ error: "Only tenant admins can add items to a knowledge base." });
  });

  it("unknown knowledgeBaseId lists accessible KB names, no cross-tenant oracle", async () => {
    const { db } = makeFakeDb({ kbExists: false, kbNames: ["Sales SOPs", "HR Policies"] });
    const result = await createKnowledgeItemTool.execute(fixtureCtx(db), input);
    expect(result).toEqual({ error: "Knowledge base not found. Available knowledge bases: Sales SOPs, HR Policies." });
  });

  it("unknown knowledgeBaseId with zero KBs configured gets a distinct message", async () => {
    const { db } = makeFakeDb({ kbExists: false, kbNames: [] });
    const result = await createKnowledgeItemTool.execute(fixtureCtx(db), input);
    expect(result).toEqual({ error: "Knowledge base not found. This tenant has no knowledge bases configured." });
  });

  it("inserts with created_via:'ai_assistant' + ai_tool_call_id from ctx.toolCallId", async () => {
    const { db, inserted } = makeFakeDb({ kbExists: true });
    await createKnowledgeItemTool.execute(fixtureCtx(db, { toolCallId: "tc-99" }), input);
    expect(inserted[0]).toMatchObject({
      type: "note",
      knowledge_base_id: KB_ID,
      title: "Q3 pricing notes",
      content: "Discount cap is 15%.",
      created_via: "ai_assistant",
      ai_tool_call_id: "tc-99",
    });
  });

  it("status:'ready', no ingest event when isIngestionEnabled() is false", async () => {
    isIngestionEnabledMock.mockReturnValue(false);
    const { db, inserted } = makeFakeDb({ kbExists: true });
    await createKnowledgeItemTool.execute(fixtureCtx(db), input);
    expect(inserted[0]).toMatchObject({ status: "ready" });
    expect(inngestSendMock).not.toHaveBeenCalled();
  });

  it("status:'pending' + fires kb/item.ingest.requested when isIngestionEnabled() is true", async () => {
    isIngestionEnabledMock.mockReturnValue(true);
    const { db, inserted } = makeFakeDb({ kbExists: true });
    await createKnowledgeItemTool.execute(fixtureCtx(db), input);
    expect(inserted[0]).toMatchObject({ status: "pending" });
    expect(inngestSendMock).toHaveBeenCalledWith({
      name: "kb/item.ingest.requested",
      data: { tenantId: "tenant-1", itemId: "item-1" },
    });
  });

  it("db_error on insert -> generic retry error", async () => {
    const { db } = makeFakeDb({ kbExists: true, insertError: { message: "boom" } });
    const result = await createKnowledgeItemTool.execute(fixtureCtx(db), input);
    expect(result).toEqual({ error: "Failed to save the knowledge item. Try again." });
  });

  it("ok returns itemId/knowledgeBaseId/title/note marking it AI-written", async () => {
    const { db } = makeFakeDb({ kbExists: true });
    const result = await createKnowledgeItemTool.execute(fixtureCtx(db), input);
    expect(result).toEqual({
      itemId: "item-1",
      knowledgeBaseId: KB_ID,
      title: "Q3 pricing notes",
      note: "Saved to the knowledge base, marked as AI-written.",
    });
  });

  it("records the audit log + emits the knowledge_base_item.created event", async () => {
    const { db } = makeFakeDb({ kbExists: true });
    await createKnowledgeItemTool.execute(fixtureCtx(db), input);
    expect(createAuditLogMock).toHaveBeenCalledTimes(1);
    const [auditInput] = createAuditLogMock.mock.calls[0] as unknown[];
    expect(auditInput).toMatchObject({
      action: "knowledge_base_item.created",
      entityType: "knowledge_base_item",
      entityId: "item-1",
    });
    expect(emitEventMock).toHaveBeenCalledTimes(1);
    const [eventInput] = emitEventMock.mock.calls[0] as unknown[];
    expect(eventInput).toMatchObject({
      type: "knowledge_base_item.created",
      entityId: "item-1",
      payload: { type: "note" },
    });
  });
});
