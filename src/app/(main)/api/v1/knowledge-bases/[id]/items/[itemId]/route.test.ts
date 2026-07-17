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
vi.mock("@/lib/storage/provider", () => ({ getStorageProvider: vi.fn() }));

const AUTH = { userId: "user-1", tenantId: "tenant-1", role: "admin" } as unknown as AuthContext;

function fakeReq(body: unknown): NextRequest {
  return { json: async () => body } as unknown as NextRequest;
}

function params() {
  return { params: Promise.resolve({ id: "kb-1", itemId: "item-1" }) };
}

function fakeDb(existingRow: Record<string, unknown>, updatedRow: Record<string, unknown>) {
  const selectChain = {
    eq: vi.fn(() => selectChain),
    single: vi.fn(() => Promise.resolve({ data: existingRow, error: null })),
  };
  const updateMock = vi.fn(() => ({
    eq: vi.fn(() => ({
      select: vi.fn(() => ({
        single: vi.fn(() => Promise.resolve({ data: updatedRow, error: null })),
      })),
    })),
  }));
  return {
    updateMock,
    from: vi.fn((table: string) => {
      if (table === "knowledge_base_items") {
        return { select: vi.fn(() => selectChain), update: updateMock };
      }
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

describe("PATCH /api/v1/knowledge-bases/[id]/items/[itemId] — ingestion re-trigger", () => {
  it("flag off: updates content without touching status or sending an event", async () => {
    isIngestionEnabledMock.mockReturnValue(false);
    const existing = { id: "item-1", type: "note", title: "T", content: "old", status: "ready" };
    const updated = { ...existing, content: "new" };
    const db = fakeDb(existing, updated);
    scopedClientMock.mockResolvedValue(db);

    const { PATCH } = await import("./route");
    const res = await PATCH(fakeReq({ content: "new" }), params());

    expect(res.status).toBe(200);
    expect(db.updateMock).toHaveBeenCalledWith(
      expect.not.objectContaining({ status: expect.anything() }),
    );
    expect(sendMock).not.toHaveBeenCalled();
  });

  it("flag on: re-sending note content sets status pending and sends an ingest event", async () => {
    isIngestionEnabledMock.mockReturnValue(true);
    const existing = { id: "item-1", type: "note", title: "T", content: "old", status: "ready" };
    const updated = { ...existing, content: "new", status: "pending" };
    const db = fakeDb(existing, updated);
    scopedClientMock.mockResolvedValue(db);
    sendMock.mockResolvedValue(undefined);

    const { PATCH } = await import("./route");
    const res = await PATCH(fakeReq({ content: "new" }), params());

    expect(res.status).toBe(200);
    expect(db.updateMock).toHaveBeenCalledWith(expect.objectContaining({ status: "pending" }));
    expect(sendMock).toHaveBeenCalledWith({
      name: "kb/item.ingest.requested",
      data: { tenantId: "tenant-1", itemId: "item-1" },
    });
  });

  it("flag on: title-only update does not re-trigger ingestion", async () => {
    isIngestionEnabledMock.mockReturnValue(true);
    const existing = { id: "item-1", type: "note", title: "T", content: "old", status: "ready" };
    const updated = { ...existing, title: "New Title" };
    const db = fakeDb(existing, updated);
    scopedClientMock.mockResolvedValue(db);

    const { PATCH } = await import("./route");
    const res = await PATCH(fakeReq({ title: "New Title" }), params());

    expect(res.status).toBe(200);
    expect(db.updateMock).toHaveBeenCalledWith(
      expect.not.objectContaining({ status: expect.anything() }),
    );
    expect(sendMock).not.toHaveBeenCalled();
  });
});
