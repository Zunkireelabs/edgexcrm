import { describe, it, expect, vi, beforeEach } from "vitest";
import type { AuthContext } from "@/lib/api/auth";

// PATCH /inbox/conversations/[id] — on a website chat the owner can no longer be changed through this route
// (that would bypass "one owner"); everything else, and every other channel, behaves as before.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = Record<string, any>;

const authMock = vi.fn();
let conv: Row;
let updates: Row[];

vi.mock("@/lib/api/auth", () => ({ authenticateRequest: () => authMock(), requireAdmin: (a: { role: string }) => a.role === "owner" || a.role === "admin" }));
vi.mock("@/lib/inbox/scope", () => ({ canAccessConversationLead: async () => true, canSeeLinkedLead: async () => true }));
vi.mock("@/lib/notifications", () => ({ createNotification: async () => {}, NotificationTypes: { INBOX_ASSIGNED: "inbox.assigned" } }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({}),
  createServiceClient: async () => ({
    from: () => {
      const st = { op: "select", payload: undefined as Row | undefined };
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const b: any = {
        select: () => b,
        update: (p: Row) => ((st.op = "update"), (st.payload = p), updates.push(p), b),
        eq: () => b,
        maybeSingle: async () => ({ data: { ...conv }, error: null }),
        single: async () => ({ data: { ...conv, ...(st.payload ?? {}) }, error: null }),
      };
      return b;
    },
  }),
}));

import { PATCH } from "./route";

const AUTH = { userId: "u1", tenantId: "t", role: "admin", permissions: {} } as unknown as AuthContext;
const call = (body: Row) => PATCH({ json: async () => body } as never, { params: Promise.resolve({ id: "conv-1" }) });

beforeEach(() => {
  updates = [];
  conv = { id: "conv-1", lead_id: null, assigned_to_user_id: "manish", provider: "chatwoot" };
  authMock.mockReset().mockResolvedValue(AUTH);
});

describe("PATCH /inbox/conversations/[id] — owner changes on website chats", () => {
  it("refuses to change the owner and says to use Accept / Hand over", async () => {
    const res = await call({ assigned_to_user_id: "bijay", assignee_type: "human" });
    expect(res.status).toBe(409);
    expect((await res.json()).error.code).toBe("USE_CLAIM");
    expect(updates).toHaveLength(0);
  });
  it("also refuses clearing the owner (unassign)", async () => {
    expect((await call({ assignee_type: "unassigned", assigned_to_user_id: null })).status).toBe(409);
    expect(updates).toHaveLength(0);
  });
  it("still allows everything else on a website chat (status, stage tag)", async () => {
    const res = await call({ status: "closed", stage_tag: "hot" });
    expect(res.status).toBe(200);
    expect(updates).toEqual([{ status: "closed", stage_tag: "hot" }]);
  });
  it("WhatsApp conversations can still be assigned this way, exactly as today", async () => {
    conv = { ...conv, provider: "whatsapp" };
    const res = await call({ assigned_to_user_id: "bijay", assignee_type: "human" });
    expect(res.status).toBe(200);
    expect(updates).toEqual([{ assigned_to_user_id: "bijay", assignee_type: "human" }]);
  });
});
