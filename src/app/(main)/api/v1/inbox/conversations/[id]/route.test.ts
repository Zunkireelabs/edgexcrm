import { describe, it, expect, vi, beforeEach } from "vitest";
import type { NextRequest } from "next/server";

// S3 item 3 (docs/WHATSAPP-GOLIVE-SONNET-BRIEF.md follow-up): PATCH only verified the
// conversation's CURRENT lead was visible to the caller — it never checked the NEW
// lead_id being set, so a counselor/branch-scoped caller could link a conversation to
// an arbitrary lead elsewhere in the tenant it otherwise can't see. Fixed by running
// the same canAccessConversationLead check against the incoming lead_id too.

const authenticateRequestMock = vi.fn();
const canAccessConversationLeadMock = vi.fn();
const createNotificationMock = vi.fn();

vi.mock("@/lib/api/auth", () => ({ authenticateRequest: authenticateRequestMock }));
vi.mock("@/lib/inbox/scope", () => ({ canAccessConversationLead: canAccessConversationLeadMock }));
vi.mock("@/lib/notifications", () => ({
  createNotification: createNotificationMock,
  NotificationTypes: { INBOX_ASSIGNED: "inbox_assigned" },
}));

const AUTH = { tenantId: "tenant-1", userId: "user-1", branchId: null, permissions: {} as Record<string, unknown> };

function fakeDb(opts: { currentLeadId: string | null; updateFails?: boolean }) {
  const updates: Record<string, unknown>[] = [];
  const db = {
    from(table: string) {
      if (table !== "conversations") throw new Error(`unexpected table: ${table}`);
      return {
        select: () => ({
          eq: () => ({
            eq: () => ({
              maybeSingle: () =>
                Promise.resolve({
                  data: { id: "conv-1", lead_id: opts.currentLeadId, assigned_to_user_id: null },
                  error: null,
                }),
            }),
          }),
        }),
        update: (patch: Record<string, unknown>) => {
          updates.push(patch);
          return {
            eq: () => ({
              eq: () => ({
                select: () => ({
                  single: () =>
                    opts.updateFails
                      ? Promise.resolve({ data: null, error: { message: "update failed" } })
                      : Promise.resolve({ data: { id: "conv-1", ...patch }, error: null }),
                }),
              }),
            }),
          };
        },
      };
    },
  };
  return { db, updates };
}

function fakeReq(body: Record<string, unknown>): NextRequest {
  return { json: () => Promise.resolve(body) } as unknown as NextRequest;
}

const params = Promise.resolve({ id: "conv-1" });

describe("PATCH /api/v1/inbox/conversations/[id] — lead_id scope gap (S3)", () => {
  beforeEach(() => {
    authenticateRequestMock.mockReset();
    authenticateRequestMock.mockResolvedValue(AUTH);
    canAccessConversationLeadMock.mockReset();
    createNotificationMock.mockReset();
  });

  it("a counselor cannot link the conversation to a lead outside their scope → 404, never updates", async () => {
    // Current lead (null, unlinked) is visible per the existing check; the NEW lead_id
    // being set is NOT.
    canAccessConversationLeadMock.mockImplementation((_clients: unknown, _auth: unknown, leadId: string | null) =>
      Promise.resolve(leadId === null || leadId === "visible-lead")
    );
    const { db, updates } = fakeDb({ currentLeadId: null });
    vi.doMock("@/lib/supabase/server", () => ({
      createServiceClient: () => Promise.resolve(db),
      createClient: () => Promise.resolve({}),
    }));
    vi.resetModules();
    vi.doMock("@/lib/api/auth", () => ({ authenticateRequest: authenticateRequestMock }));
    vi.doMock("@/lib/inbox/scope", () => ({ canAccessConversationLead: canAccessConversationLeadMock }));
    vi.doMock("@/lib/notifications", () => ({ createNotification: createNotificationMock, NotificationTypes: { INBOX_ASSIGNED: "inbox_assigned" } }));
    vi.doMock("@/lib/supabase/server", () => ({
      createServiceClient: () => Promise.resolve(db),
      createClient: () => Promise.resolve({}),
    }));
    const { PATCH } = await import("./route");

    const res = await PATCH(fakeReq({ lead_id: "out-of-scope-lead" }), { params });

    expect(res.status).toBe(404);
    expect(updates).toHaveLength(0);
  });

  it("an admin (unrestricted scope) can link the conversation to any lead in the tenant", async () => {
    // Unrestricted scope → canAccessConversationLead always resolves true, exactly as
    // it does for the existing-lead check.
    canAccessConversationLeadMock.mockResolvedValue(true);
    const { db, updates } = fakeDb({ currentLeadId: null });
    vi.resetModules();
    vi.doMock("@/lib/api/auth", () => ({ authenticateRequest: authenticateRequestMock }));
    vi.doMock("@/lib/inbox/scope", () => ({ canAccessConversationLead: canAccessConversationLeadMock }));
    vi.doMock("@/lib/notifications", () => ({ createNotification: createNotificationMock, NotificationTypes: { INBOX_ASSIGNED: "inbox_assigned" } }));
    vi.doMock("@/lib/supabase/server", () => ({
      createServiceClient: () => Promise.resolve(db),
      createClient: () => Promise.resolve({}),
    }));
    const { PATCH } = await import("./route");

    const res = await PATCH(fakeReq({ lead_id: "any-lead-in-tenant" }), { params });

    expect(res.status).toBe(200);
    expect(updates).toHaveLength(1);
    expect(updates[0]).toEqual({ lead_id: "any-lead-in-tenant" });
  });

  it("unsetting lead_id (null) needs no visibility check — it only removes exposure", async () => {
    canAccessConversationLeadMock.mockImplementation((_clients: unknown, _auth: unknown, leadId: string | null) =>
      Promise.resolve(leadId === "current-lead")
    );
    const { db, updates } = fakeDb({ currentLeadId: "current-lead" });
    vi.resetModules();
    vi.doMock("@/lib/api/auth", () => ({ authenticateRequest: authenticateRequestMock }));
    vi.doMock("@/lib/inbox/scope", () => ({ canAccessConversationLead: canAccessConversationLeadMock }));
    vi.doMock("@/lib/notifications", () => ({ createNotification: createNotificationMock, NotificationTypes: { INBOX_ASSIGNED: "inbox_assigned" } }));
    vi.doMock("@/lib/supabase/server", () => ({
      createServiceClient: () => Promise.resolve(db),
      createClient: () => Promise.resolve({}),
    }));
    const { PATCH } = await import("./route");

    const res = await PATCH(fakeReq({ lead_id: null }), { params });

    expect(res.status).toBe(200);
    expect(updates).toHaveLength(1);
    expect(updates[0]).toEqual({ lead_id: null });
  });

  it("a patch with no lead_id key is unaffected by the new check", async () => {
    canAccessConversationLeadMock.mockResolvedValue(true);
    const { db, updates } = fakeDb({ currentLeadId: "current-lead" });
    vi.resetModules();
    vi.doMock("@/lib/api/auth", () => ({ authenticateRequest: authenticateRequestMock }));
    vi.doMock("@/lib/inbox/scope", () => ({ canAccessConversationLead: canAccessConversationLeadMock }));
    vi.doMock("@/lib/notifications", () => ({ createNotification: createNotificationMock, NotificationTypes: { INBOX_ASSIGNED: "inbox_assigned" } }));
    vi.doMock("@/lib/supabase/server", () => ({
      createServiceClient: () => Promise.resolve(db),
      createClient: () => Promise.resolve({}),
    }));
    const { PATCH } = await import("./route");

    const res = await PATCH(fakeReq({ status: "closed" }), { params });

    expect(res.status).toBe(200);
    expect(updates).toEqual([{ status: "closed" }]);
  });
});
