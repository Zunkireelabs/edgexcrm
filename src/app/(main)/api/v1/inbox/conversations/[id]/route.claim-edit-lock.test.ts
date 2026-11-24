import { describe, it, expect, vi, beforeEach } from "vitest";
import type { AuthContext } from "@/lib/api/auth";

// PATCH /inbox/conversations/[id] — "others read-only" means read-only: on a website chat only the person handling it
// (or an admin) may close, snooze, tag or re-link it.

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
    auth: { admin: { getUserById: async () => ({ data: { user: { user_metadata: { name: "Manish" } } } }) } },
    from: () => {
      const st = { payload: undefined as Row | undefined };
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const b: any = {
        select: () => b,
        update: (p: Row) => ((st.payload = p), updates.push(p), b),
        eq: () => b,
        maybeSingle: async () => ({ data: { ...conv }, error: null }),
        single: async () => ({ data: { ...conv, ...(st.payload ?? {}) }, error: null }),
      };
      return b;
    },
  }),
}));

import { PATCH } from "./route";

const AUTH = (userId: string, role = "staff"): AuthContext => ({ userId, tenantId: "t", role, permissions: {} }) as unknown as AuthContext;
const call = (body: Row) => PATCH({ json: async () => body } as never, { params: Promise.resolve({ id: "conv-1" }) });

beforeEach(() => {
  updates = [];
  conv = { id: "conv-1", lead_id: null, provider: "chatwoot", assignee_type: "human", assigned_to_user_id: "manish" };
  authMock.mockReset().mockResolvedValue(AUTH("bijay"));
});

describe("PATCH on a website chat someone else is handling", () => {
  it("refuses a teammate who isn't handling it, naming who is, and changes nothing", async () => {
    for (const body of [{ status: "closed" }, { stage_tag: "hot" }, { lead_id: "lead-9" }, { snoozed_until: "2026-12-01T00:00:00Z" }]) {
      const res = await call(body);
      expect(res.status).toBe(403);
      const json = await res.json();
      expect(json.error.code).toBe("NOT_CHAT_OWNER");
      expect(json.error.message).toContain("Manish is handling this chat");
    }
    expect(updates).toHaveLength(0);
  });

  it("the person handling it can change it", async () => {
    authMock.mockResolvedValue(AUTH("manish"));
    expect((await call({ status: "closed" })).status).toBe(200);
    expect(updates).toEqual([{ status: "closed" }]);
  });

  it("an admin can change it", async () => {
    authMock.mockResolvedValue(AUTH("sadin", "admin"));
    expect((await call({ status: "closed" })).status).toBe(200);
    expect(updates).toEqual([{ status: "closed" }]);
  });
});

describe("PATCH on a website chat nobody has accepted", () => {
  beforeEach(() => {
    conv = { ...conv, assignee_type: "unassigned", assigned_to_user_id: null };
  });
  it("a normal teammate must accept it first", async () => {
    const res = await call({ status: "closed" });
    expect(res.status).toBe(403);
    expect((await res.json()).error.message).toContain("Accept this chat first");
    expect(updates).toHaveLength(0);
  });
  it("an admin can still change it", async () => {
    authMock.mockResolvedValue(AUTH("sadin", "admin"));
    expect((await call({ status: "closed" })).status).toBe(200);
  });
});

describe("other channels are unchanged", () => {
  it("anyone with access can still change a WhatsApp conversation, owner or not", async () => {
    conv = { ...conv, provider: "whatsapp" };
    expect((await call({ status: "closed" })).status).toBe(200);
    expect(updates).toEqual([{ status: "closed" }]);
  });
});
