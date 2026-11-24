import { describe, it, expect, vi, beforeEach } from "vitest";
import type { AuthContext } from "@/lib/api/auth";

// POST /api/v1/inbox/conversations/[id]/handover — owner hands a website chat to a teammate; an admin can take over.
// In-memory fake database. The fake only protects against a changed owner if the route asks for that condition.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = Record<string, any>;

const authMock = vi.fn();
const notifyMock = vi.fn(async (args: Row) => {
  void args;
});
vi.mock("@/lib/api/auth", () => ({
  authenticateRequest: () => authMock(),
  requireAdmin: (a: { role: string }) => a.role === "owner" || a.role === "admin",
}));
vi.mock("@/lib/notifications", () => ({
  createNotification: (a: Row) => notifyMock(a),
  NotificationTypes: { INBOX_ASSIGNED: "inbox.assigned" },
}));

const U = {
  manish: "11111111-1111-4111-8111-111111111111",
  bijay: "22222222-2222-4222-8222-222222222222",
  sadin: "33333333-3333-4333-8333-333333333333",
  nobody: "44444444-4444-4444-8444-444444444444",
  hidden: "55555555-5555-4555-8555-555555555555",
};
const NAMES: Record<string, string> = { [U.manish]: "Manish", [U.bijay]: "Bijay", [U.sadin]: "Sadin" };

let conv: Row;
let inserted: Row[];
let members: Record<string, Row | null>;
let ownerChangesBeforeUpdate: string | null;
let missing = false;

function fakeDb() {
  return {
    auth: { admin: { getUserById: async (id: string) => ({ data: { user: { user_metadata: { name: NAMES[id] ?? null }, email: `${id}@x.com` } } }) } },
    from(table: string) {
      const st = { op: "select", payload: undefined as Row | undefined, eqs: [] as [string, unknown][] };
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const b: any = {
        select: () => b,
        update: (p: Row) => ((st.op = "update"), (st.payload = p), b),
        insert: async (row: Row) => {
          inserted.push(row);
          return { error: null };
        },
        eq: (c: string, v: unknown) => (st.eqs.push([c, v]), b),
        maybeSingle: async () => {
          if (table === "tenant_users") {
            const uid = st.eqs.find(([c]) => c === "user_id")?.[1] as string;
            return { data: members[uid] ?? null, error: null };
          }
          if (table !== "conversations" || missing) return { data: null, error: null };
          if (st.op === "update") {
            if (ownerChangesBeforeUpdate) conv.assigned_to_user_id = ownerChangesBeforeUpdate; // someone else moved it first
            // The update only protects against a changed owner if the route asked for "still owned by X".
            const guard = st.eqs.find(([c]) => c === "assigned_to_user_id");
            if (guard && guard[1] !== conv.assigned_to_user_id) return { data: null, error: null };
            Object.assign(conv, st.payload);
            return { data: { id: conv.id }, error: null };
          }
          return { data: { ...conv }, error: null };
        },
      };
      return b;
    },
  };
}
vi.mock("@/lib/supabase/server", () => ({ createServiceClient: async () => fakeDb() }));

import { POST } from "./route";

const AUTH = (userId: string, role = "staff") => ({ userId, tenantId: "tenant-a", role, permissions: {} }) as unknown as AuthContext;
const call = (to: unknown, id = "conv-1") =>
  POST({ json: async () => ({ to_user_id: to }) } as never, { params: Promise.resolve({ id }) });

beforeEach(() => {
  inserted = [];
  ownerChangesBeforeUpdate = null;
  missing = false;
  notifyMock.mockClear();
  conv = {
    id: "conv-1", provider: "chatwoot", channel_id: "ch-1", assignee_type: "human", assigned_to_user_id: U.manish,
    contact_display_name: "Ram Sharma", contact_phone: null,
  };
  members = {
    [U.manish]: { role: "staff", suspended_at: null, positions: null },
    [U.bijay]: { role: "staff", suspended_at: null, positions: null },
    [U.sadin]: { role: "admin", suspended_at: null, positions: null },
    [U.hidden]: { role: "staff", suspended_at: null, positions: { permissions: { nav: { mode: "allow", keys: ["/leads"] }, leadScope: "own" } } },
  };
  authMock.mockReset().mockResolvedValue(AUTH(U.manish));
});

describe("POST /inbox/conversations/[id]/handover", () => {
  it("401s without a session and 422s a bad user id", async () => {
    authMock.mockResolvedValue(null);
    expect((await call(U.bijay)).status).toBe(401);
    authMock.mockResolvedValue(AUTH(U.manish));
    expect((await call("not-a-uuid")).status).toBe(422);
    expect((await call(undefined)).status).toBe(422);
  });

  it("404s a conversation that isn't in this tenant", async () => {
    missing = true;
    expect((await call(U.bijay)).status).toBe(404);
    expect(inserted).toHaveLength(0);
  });

  it("the owner hands the chat to a teammate: owner changes, note written, new owner notified", async () => {
    const res = await call(U.bijay);
    expect(res.status).toBe(200);
    expect((await res.json()).data).toMatchObject({ owner_id: U.bijay, owner_name: "Bijay" });
    expect(conv.assigned_to_user_id).toBe(U.bijay);
    expect(inserted).toHaveLength(1);
    expect(inserted[0]).toMatchObject({ author_type: "system", content_text: "Manish handed this chat to Bijay", status: "sent" });
    expect(notifyMock).toHaveBeenCalledTimes(1);
    expect(notifyMock.mock.calls[0][0]).toMatchObject({
      userId: U.bijay, type: "inbox.assigned", link: "/inbox?conversation=conv-1",
    });
  });

  it("someone who is neither the owner nor an admin is refused, naming the owner", async () => {
    authMock.mockResolvedValue(AUTH(U.bijay));
    const res = await call(U.sadin);
    expect(res.status).toBe(403);
    const json = await res.json();
    expect(json.error.code).toBe("NOT_CHAT_OWNER");
    expect(json.error.message).toContain("Manish is handling this chat");
    expect(conv.assigned_to_user_id).toBe(U.manish);
    expect(inserted).toHaveLength(0);
  });

  it("an admin can take a chat over (hand it to themselves), with an admin note and no self-notification", async () => {
    authMock.mockResolvedValue(AUTH(U.sadin, "admin"));
    const res = await call(U.sadin);
    expect(res.status).toBe(200);
    expect(conv.assigned_to_user_id).toBe(U.sadin);
    expect(inserted[0].content_text).toBe("Sadin (admin) took over this chat");
    expect(notifyMock).not.toHaveBeenCalled();
  });

  it("an admin can also move a chat from one person to another, and the note says so", async () => {
    authMock.mockResolvedValue(AUTH(U.sadin, "admin"));
    const res = await call(U.bijay);
    expect(res.status).toBe(200);
    expect(conv.assigned_to_user_id).toBe(U.bijay);
    expect(inserted[0].content_text).toBe("Sadin (admin) moved this chat from Manish to Bijay");
    expect(notifyMock).toHaveBeenCalledTimes(1);
  });

  it("refuses a target whose position hides the Inbox, and nothing changes", async () => {
    const res = await call(U.hidden);
    expect(res.status).toBe(422);
    expect((await res.json()).error.code).toBe("TARGET_CANNOT_OPEN_INBOX");
    expect(conv.assigned_to_user_id).toBe(U.manish);
    expect(inserted).toHaveLength(0);
    expect(notifyMock).not.toHaveBeenCalled();
  });

  it("refuses someone who isn't on this team", async () => {
    const res = await call(U.nobody);
    expect(res.status).toBe(422);
    expect(conv.assigned_to_user_id).toBe(U.manish);
  });

  it("handing it to the person who already has it changes nothing (no note, no notification)", async () => {
    const res = await call(U.manish);
    expect(res.status).toBe(200);
    expect((await res.json()).data.unchanged).toBe(true);
    expect(inserted).toHaveLength(0);
    expect(notifyMock).not.toHaveBeenCalled();
  });

  it("says to use Accept when nobody has the chat yet", async () => {
    conv.assignee_type = "unassigned";
    conv.assigned_to_user_id = null;
    const res = await call(U.bijay);
    expect(res.status).toBe(409);
    expect((await res.json()).error.code).toBe("NOT_ACCEPTED");
  });

  it("does nothing for WhatsApp and other channels", async () => {
    conv.provider = "whatsapp";
    const res = await call(U.bijay);
    expect(res.status).toBe(409);
    expect((await res.json()).error.code).toBe("NOT_CLAIMABLE");
    expect(conv.assigned_to_user_id).toBe(U.manish);
  });

  it("if the chat changed hands while this request was running, it is refused (409) rather than overwritten", async () => {
    ownerChangesBeforeUpdate = U.sadin; // an admin moved it first
    const res = await call(U.bijay);
    expect(res.status).toBe(409);
    expect((await res.json()).error.code).toBe("CHAT_CHANGED");
    expect(conv.assigned_to_user_id).toBe(U.sadin);
    expect(inserted).toHaveLength(0);
    expect(notifyMock).not.toHaveBeenCalled();
  });

  it("a failed notification does not undo the hand-over", async () => {
    notifyMock.mockRejectedValueOnce(new Error("notifications down"));
    const res = await call(U.bijay);
    expect(res.status).toBe(200);
    expect(conv.assigned_to_user_id).toBe(U.bijay);
  });
});
