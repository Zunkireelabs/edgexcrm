import { describe, it, expect, vi, beforeEach } from "vitest";
import type { AuthContext } from "@/lib/api/auth";

// PATCH /inbox/conversations/[id] with ai_autonomy: the per-chat AI switch. Only valid values; switching AI back on clears the
// "Needs a human" flag; the website-chat edit lock (owner or admin) still applies.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = Record<string, any>;
const authMock = vi.fn();
let conv: Row;
let updates: Row[];

vi.mock("@/lib/api/auth", () => ({
  authenticateRequest: () => authMock(),
  requireAdmin: (a: { role: string }) => a.role === "owner" || a.role === "admin",
}));
vi.mock("@/lib/inbox/scope", () => ({ canAccessConversationLead: async () => true, canSeeLinkedLead: async () => true }));
vi.mock("@/lib/notifications", () => ({ createNotification: vi.fn(), NotificationTypes: { INBOX_ASSIGNED: "x" } }));
vi.mock("@/lib/supabase/server", () => {
  const db = () => ({
    auth: { admin: { getUserById: async () => ({ data: { user: { user_metadata: {}, email: "x@y" } } }) } },
    from() {
      const st = { op: "select", payload: undefined as Row | undefined };
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const b: any = {
        select: () => b,
        update: (p: Row) => ((st.op = "update"), (st.payload = p), b),
        eq: () => b,
        single: async () => {
          if (st.op === "update") {
            updates.push(st.payload!);
            Object.assign(conv, st.payload);
          }
          return { data: { ...conv }, error: null };
        },
        maybeSingle: async () => ({ data: { ...conv }, error: null }),
      };
      return b;
    },
  });
  return { createServiceClient: async () => db(), createClient: async () => db() };
});

import { PATCH } from "./route";

const AUTH = (userId: string, role = "staff") => ({ userId, tenantId: "tenant-a", role, permissions: { allowedNavKeys: null } }) as unknown as AuthContext;
const patch = (body: unknown) =>
  PATCH(new Request("http://x", { method: "PATCH", body: JSON.stringify(body) }) as never, { params: Promise.resolve({ id: "conv-1" }) });

beforeEach(() => {
  updates = [];
  conv = { id: "conv-1", provider: "chatwoot", lead_id: null, assignee_type: "human", assigned_to_user_id: "me", ai_autonomy: "autonomous", meta: {} };
  authMock.mockReset().mockResolvedValue(AUTH("me"));
});

describe("PATCH ai_autonomy", () => {
  it("the owner can turn AI off for their chat", async () => {
    expect((await patch({ ai_autonomy: "off" })).status).toBe(200);
    expect(conv.ai_autonomy).toBe("off");
  });

  it("refuses a value that is not off / suggest / autonomous", async () => {
    expect((await patch({ ai_autonomy: "yes" })).status).toBe(422);
    expect(updates).toHaveLength(0);
  });

  it("switching AI back on clears the 'Needs a human' flag and keeps other meta", async () => {
    conv.meta = { contact_email: "a@b.com", needs_human: { at: "2026-11-25T10:00:00Z", reason: "out_of_knowledge" } };
    await patch({ ai_autonomy: "autonomous" });
    expect(conv.meta).toEqual({ contact_email: "a@b.com" });
  });

  it("switching AI off leaves the flag alone", async () => {
    conv.meta = { needs_human: { at: "2026-11-25T10:00:00Z", reason: "out_of_knowledge" } };
    await patch({ ai_autonomy: "off" });
    expect(updates[0]).toEqual({ ai_autonomy: "off" });
  });

  it("someone who is not the owner (and not an admin) cannot change it", async () => {
    authMock.mockResolvedValue(AUTH("other"));
    expect((await patch({ ai_autonomy: "off" })).status).toBe(403);
    expect(updates).toHaveLength(0);
  });
});
