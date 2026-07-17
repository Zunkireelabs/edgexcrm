import { describe, it, expect, vi, beforeEach } from "vitest";
import type { NextRequest } from "next/server";
import type { AuthContext } from "@/lib/api/auth";

const authenticateRequestMock = vi.fn();
const scopedClientMock = vi.fn();
const isIngestionEnabledMock = vi.fn();
const sendMock = vi.fn();

vi.mock("@/lib/api/auth", () => ({
  authenticateRequest: authenticateRequestMock,
  requireAdmin: () => true,
}));
vi.mock("@/lib/supabase/scoped", () => ({ scopedClient: scopedClientMock }));
vi.mock("@/lib/ai/flag", () => ({ isIngestionEnabled: isIngestionEnabledMock }));
vi.mock("@/lib/ai/ingestion/inngest", () => ({ inngest: { send: sendMock } }));
vi.mock("@/lib/api/audit", () => ({
  createAuditLog: vi.fn(async () => {}),
  emitEvent: vi.fn(async () => null),
}));

const AUTH = { userId: "user-1", tenantId: "tenant-1", role: "admin" } as unknown as AuthContext;

function fakeReq(body: unknown): NextRequest {
  return { json: async () => body } as unknown as NextRequest;
}

function params() {
  return { params: Promise.resolve({ id: "kb-1" }) };
}

function fakeDb(createdItem: Record<string, unknown>) {
  const kbQuery = { eq: vi.fn(() => kbQuery), single: vi.fn(() => Promise.resolve({ data: { id: "kb-1" } })) };
  const insertSelect = { single: vi.fn(() => Promise.resolve({ data: createdItem, error: null })) };
  const itemsTable = { insert: vi.fn(() => ({ select: vi.fn(() => insertSelect) })) };
  const kbTable = { select: vi.fn(() => kbQuery) };
  return {
    itemsTable,
    from: vi.fn((table: string) => {
      if (table === "knowledge_bases") return kbTable;
      if (table === "knowledge_base_items") return itemsTable;
      return {};
    }),
  };
}

beforeEach(() => {
  authenticateRequestMock.mockReset();
  scopedClientMock.mockReset();
  isIngestionEnabledMock.mockReset();
  sendMock.mockReset();
  authenticateRequestMock.mockResolvedValue(AUTH);
});

describe("POST /api/v1/knowledge-bases/[id]/items — ingestion trigger", () => {
  it("flag off: creates the item as 'ready' and does not send an ingest event", async () => {
    isIngestionEnabledMock.mockReturnValue(false);
    const created = { id: "item-1", type: "note", status: "ready" };
    const db = fakeDb(created);
    scopedClientMock.mockResolvedValue(db);

    const { POST } = await import("./route");
    const res = await POST(fakeReq({ type: "note", title: "T", content: "hello" }), params());

    expect(res.status).toBe(201);
    expect(db.itemsTable.insert).toHaveBeenCalledWith(expect.objectContaining({ status: "ready" }));
    expect(sendMock).not.toHaveBeenCalled();
  });

  it("flag on: creates the item as 'pending' and sends an ingest event", async () => {
    isIngestionEnabledMock.mockReturnValue(true);
    const created = { id: "item-2", type: "note", status: "pending" };
    const db = fakeDb(created);
    scopedClientMock.mockResolvedValue(db);
    sendMock.mockResolvedValue(undefined);

    const { POST } = await import("./route");
    const res = await POST(fakeReq({ type: "note", title: "T", content: "hello" }), params());

    expect(res.status).toBe(201);
    expect(db.itemsTable.insert).toHaveBeenCalledWith(expect.objectContaining({ status: "pending" }));
    expect(sendMock).toHaveBeenCalledWith({
      name: "kb/item.ingest.requested",
      data: { tenantId: "tenant-1", itemId: "item-2" },
    });
  });
});
