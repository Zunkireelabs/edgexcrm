import { describe, it, expect, vi, beforeEach } from "vitest";
import type { NextRequest } from "next/server";
import type { AuthContext } from "@/lib/api/auth";

// The campaigns-list "Delete" used to be a soft-delete to status='cancelled'
// with no list filter, so a deleted blast reappeared on refresh and an
// already-cancelled one 409'd forever. DELETE now: hard-deletes a blast that
// never materialized a recipient, soft-hides (deleted_at) one with send
// history, and 409s an in-flight blast. Mocked db, no real Supabase — mirrors
// the send/cancel route test pattern.

const requireEmailCampaignsAccessMock = vi.fn();
vi.mock("@/lib/email/outbound/api-guard", () => ({ requireEmailCampaignsAccess: requireEmailCampaignsAccessMock }));

const AUTH = { userId: "user-1", tenantId: "tenant-1", role: "owner" } as unknown as AuthContext;
const params = Promise.resolve({ id: "blast-1" });

function fakeReq(): NextRequest {
  return {} as unknown as NextRequest;
}

/** @param opts.blastStatus  status of blast-1 (undefined => row not found)
 *  @param opts.messageCount  how many email_messages rows link to blast-1 */
function fakeDb(opts: { blastStatus?: string; messageCount?: number }) {
  const calls = {
    blastHardDeleted: false,
    blastSoftDeletedAt: null as string | null,
    strayMessagesDeleted: false,
  };
  const blastRow = opts.blastStatus ? { id: "blast-1", status: opts.blastStatus, deleted_at: null } : null;

  const db = {
    from(table: string) {
      if (table === "email_blasts") {
        return {
          select: () => ({
            eq: () => ({
              is: () => ({ maybeSingle: () => Promise.resolve({ data: blastRow, error: null }) }),
            }),
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
      if (table === "email_messages") {
        return {
          select: () => ({
            eq: () => ({
              eq: () => Promise.resolve({ count: opts.messageCount ?? 0, error: null }),
            }),
          }),
          delete: () => ({
            eq: () => ({
              eq: () => {
                calls.strayMessagesDeleted = true;
                return Promise.resolve({ error: null });
              },
            }),
          }),
        };
      }
      throw new Error(`unexpected table: ${table}`);
    },
  };

  return { db, calls };
}

describe("DELETE /api/v1/email-blasts/[id]", () => {
  beforeEach(() => requireEmailCampaignsAccessMock.mockReset());

  it("hard-deletes a draft that never materialized a recipient", async () => {
    const fake = fakeDb({ blastStatus: "draft", messageCount: 0 });
    requireEmailCampaignsAccessMock.mockResolvedValue({ ok: true, auth: AUTH, db: fake.db });
    const { DELETE } = await import("./route");

    const res = await DELETE(fakeReq(), { params });
    expect(res.status).toBe(200);
    expect(fake.calls.blastHardDeleted).toBe(true);
    expect(fake.calls.blastSoftDeletedAt).toBeNull();
  });

  it("hard-deletes an already-cancelled draft (the case that used to 409 forever)", async () => {
    const fake = fakeDb({ blastStatus: "cancelled", messageCount: 0 });
    requireEmailCampaignsAccessMock.mockResolvedValue({ ok: true, auth: AUTH, db: fake.db });
    const { DELETE } = await import("./route");

    const res = await DELETE(fakeReq(), { params });
    expect(res.status).toBe(200);
    expect(fake.calls.blastHardDeleted).toBe(true);
  });

  it("soft-hides (deleted_at) a blast that has send history instead of destroying it", async () => {
    const fake = fakeDb({ blastStatus: "sent", messageCount: 42 });
    requireEmailCampaignsAccessMock.mockResolvedValue({ ok: true, auth: AUTH, db: fake.db });
    const { DELETE } = await import("./route");

    const res = await DELETE(fakeReq(), { params });
    expect(res.status).toBe(200);
    expect(fake.calls.blastHardDeleted).toBe(false);
    expect(fake.calls.blastSoftDeletedAt).toEqual(expect.any(String));
  });

  it("409s an in-flight blast — it must be cancelled first", async () => {
    const fake = fakeDb({ blastStatus: "sending", messageCount: 10 });
    requireEmailCampaignsAccessMock.mockResolvedValue({ ok: true, auth: AUTH, db: fake.db });
    const { DELETE } = await import("./route");

    const res = await DELETE(fakeReq(), { params });
    expect(res.status).toBe(409);
    expect(fake.calls.blastHardDeleted).toBe(false);
    expect(fake.calls.blastSoftDeletedAt).toBeNull();
  });

  it("404s when the blast does not exist (or is already deleted)", async () => {
    const fake = fakeDb({ messageCount: 0 });
    requireEmailCampaignsAccessMock.mockResolvedValue({ ok: true, auth: AUTH, db: fake.db });
    const { DELETE } = await import("./route");

    const res = await DELETE(fakeReq(), { params });
    expect(res.status).toBe(404);
  });
});
