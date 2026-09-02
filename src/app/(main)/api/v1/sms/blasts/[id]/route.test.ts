import { describe, it, expect, vi, beforeEach } from "vitest";
import type { NextRequest } from "next/server";
import type { AuthContext } from "@/lib/api/auth";

// Same three-way delete model as the email side (see
// email-blasts/[id]/route.test.ts): hard-delete a never-sent blast,
// soft-hide one with send history, 409 an in-flight one. sms_messages.blast_id
// CASCADEs, so the hard delete needs no explicit message cleanup.

const requireSmsAccessMock = vi.fn();
vi.mock("@/lib/sms/api-guard", () => ({ requireSmsAccess: requireSmsAccessMock }));

const AUTH = { userId: "user-1", tenantId: "tenant-1", role: "owner" } as unknown as AuthContext;
const params = Promise.resolve({ id: "blast-1" });

function fakeReq(): NextRequest {
  return {} as unknown as NextRequest;
}

function fakeDb(opts: { blastStatus?: string; messageCount?: number }) {
  const calls = { blastHardDeleted: false, blastSoftDeletedAt: null as string | null };
  const blastRow = opts.blastStatus ? { id: "blast-1", status: opts.blastStatus, deleted_at: null } : null;

  const db = {
    from(table: string) {
      if (table === "sms_blasts") {
        return {
          select: () => ({
            eq: () => ({ is: () => ({ maybeSingle: () => Promise.resolve({ data: blastRow, error: null }) }) }),
          }),
          update: (patch: Record<string, unknown>) => ({
            eq: () => ({
              select: () => ({
                single: () => {
                  calls.blastSoftDeletedAt = (patch.deleted_at as string) ?? null;
                  return Promise.resolve({ data: { ...blastRow, ...patch }, error: null });
                },
              }),
            }),
          }),
          delete: () => ({
            eq: () => {
              calls.blastHardDeleted = true;
              return Promise.resolve({ error: null });
            },
          }),
        };
      }
      if (table === "sms_messages") {
        return { select: () => ({ eq: () => Promise.resolve({ count: opts.messageCount ?? 0, error: null }) }) };
      }
      throw new Error(`unexpected table: ${table}`);
    },
  };

  return { db, calls };
}

describe("DELETE /api/v1/sms/blasts/[id]", () => {
  beforeEach(() => requireSmsAccessMock.mockReset());

  it("hard-deletes a draft with no materialized messages", async () => {
    const fake = fakeDb({ blastStatus: "draft", messageCount: 0 });
    requireSmsAccessMock.mockResolvedValue({ ok: true, auth: AUTH, db: fake.db });
    const { DELETE } = await import("./route");

    const res = await DELETE(fakeReq(), { params });
    expect(res.status).toBe(200);
    expect(fake.calls.blastHardDeleted).toBe(true);
  });

  it("hard-deletes an already-cancelled draft", async () => {
    const fake = fakeDb({ blastStatus: "cancelled", messageCount: 0 });
    requireSmsAccessMock.mockResolvedValue({ ok: true, auth: AUTH, db: fake.db });
    const { DELETE } = await import("./route");

    const res = await DELETE(fakeReq(), { params });
    expect(res.status).toBe(200);
    expect(fake.calls.blastHardDeleted).toBe(true);
  });

  it("soft-hides a blast that has send history", async () => {
    const fake = fakeDb({ blastStatus: "sent", messageCount: 17 });
    requireSmsAccessMock.mockResolvedValue({ ok: true, auth: AUTH, db: fake.db });
    const { DELETE } = await import("./route");

    const res = await DELETE(fakeReq(), { params });
    expect(res.status).toBe(200);
    expect(fake.calls.blastHardDeleted).toBe(false);
    expect(fake.calls.blastSoftDeletedAt).toEqual(expect.any(String));
  });

  it("409s an in-flight blast", async () => {
    const fake = fakeDb({ blastStatus: "sending", messageCount: 5 });
    requireSmsAccessMock.mockResolvedValue({ ok: true, auth: AUTH, db: fake.db });
    const { DELETE } = await import("./route");

    const res = await DELETE(fakeReq(), { params });
    expect(res.status).toBe(409);
    expect(fake.calls.blastHardDeleted).toBe(false);
  });

  it("404s when the blast does not exist", async () => {
    const fake = fakeDb({ messageCount: 0 });
    requireSmsAccessMock.mockResolvedValue({ ok: true, auth: AUTH, db: fake.db });
    const { DELETE } = await import("./route");

    const res = await DELETE(fakeReq(), { params });
    expect(res.status).toBe(404);
  });
});
