import { describe, it, expect, vi, beforeEach } from "vitest";
import type { AuthContext } from "@/lib/api/auth";

// POST /api/v1/inbox/conversations/[id]/claim — "Accept this chat". In-memory fake database; the fake enforces the
// same "only change the row while nobody owns it" condition the real update asks for, so the race test is honest.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = Record<string, any>;

const authMock = vi.fn();
vi.mock("@/lib/api/auth", () => ({ authenticateRequest: () => authMock() }));

let conv: Row | null;
let inserted: Row[];
let names: Record<string, string>;

function fakeDb() {
  return {
    auth: {
      admin: {
        getUserById: async (id: string) => ({ data: { user: { user_metadata: { name: names[id] ?? null }, email: `${id}@x.com` } } }),
      },
    },
    from(table: string) {
      const st = { op: "select", payload: undefined as Row | undefined, orFilter: "" };
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const b: any = {
        select: () => b,
        update: (p: Row) => ((st.op = "update"), (st.payload = p), b),
        insert: async (row: Row) => {
          inserted.push(row);
          return { error: null };
        },
        eq: () => b,
        or: (cond: string) => ((st.orFilter = cond), b),
        maybeSingle: async () => {
          if (table !== "conversations" || !conv) return { data: null, error: null };
          if (st.op === "update") {
            // The database only skips the update when the route asked for the "nobody owns it" condition.
            // If the route forgot that condition, the update goes through unconditionally (and the tests fail).
            const claimable = conv.assignee_type === "unassigned" || (conv.assignee_type === "human" && conv.assigned_to_user_id === null);
            const guarded = st.orFilter === "assignee_type.eq.unassigned,and(assignee_type.eq.human,assigned_to_user_id.is.null)";
            if (guarded && !claimable) return { data: null, error: null };
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

const AUTH = (userId: string, nav: string[] | null = null) =>
  ({
    userId,
    tenantId: "tenant-a",
    role: "staff",
    permissions: { allowedNavKeys: nav === null ? null : new Set(nav) },
  }) as unknown as AuthContext;

const call = (id = "conv-1") => POST({} as never, { params: Promise.resolve({ id }) });

beforeEach(() => {
  inserted = [];
  names = { manish: "Manish", bijay: "Bijay" };
  conv = { id: "conv-1", provider: "chatwoot", channel_id: "ch-1", assignee_type: "unassigned", assigned_to_user_id: null };
  authMock.mockReset().mockResolvedValue(AUTH("manish"));
});

describe("POST /inbox/conversations/[id]/claim", () => {
  it("401s without a session", async () => {
    authMock.mockResolvedValue(null);
    expect((await call()).status).toBe(401);
  });

  it("403s someone whose position hides the Inbox", async () => {
    authMock.mockResolvedValue(AUTH("manish", ["/leads"]));
    expect((await call()).status).toBe(403);
    expect(conv!.assignee_type).toBe("unassigned");
  });

  it("404s a conversation that isn't in this tenant", async () => {
    conv = null;
    expect((await call()).status).toBe(404);
  });

  it("the first person to accept becomes the owner and a team-only note is written", async () => {
    const res = await call();
    expect(res.status).toBe(200);
    expect((await res.json()).data).toMatchObject({ owner_id: "manish", owner_name: "Manish" });
    expect(conv).toMatchObject({ assignee_type: "human", assigned_to_user_id: "manish" });
    expect(inserted).toHaveLength(1);
    expect(inserted[0]).toMatchObject({
      conversation_id: "conv-1",
      channel_id: "ch-1",
      author_type: "system",
      content_text: "Manish accepted this chat",
      status: "sent",
    });
  });

  it("a second person is told who already has it (409) and nothing changes", async () => {
    await call();
    authMock.mockResolvedValue(AUTH("bijay"));
    const res = await call();
    expect(res.status).toBe(409);
    const json = await res.json();
    expect(json.error.code).toBe("ALREADY_ACCEPTED");
    expect(json.error.message).toBe("Manish is already handling this chat.");
    expect(json.error.details.owner_id).toBe("manish");
    expect(conv!.assigned_to_user_id).toBe("manish");
    expect(inserted).toHaveLength(1); // no second note
  });

  it("clicking Accept twice yourself is harmless: still yours, no duplicate note", async () => {
    await call();
    const again = await call();
    expect(again.status).toBe(200);
    expect((await again.json()).data.already_yours).toBe(true);
    expect(inserted).toHaveLength(1);
  });

  it("two people clicking at the SAME moment: exactly one wins, the other gets 409", async () => {
    const asManish = AUTH("manish");
    const asBijay = AUTH("bijay");
    authMock.mockResolvedValueOnce(asManish).mockResolvedValueOnce(asBijay);

    const [a, b] = await Promise.all([call(), call()]);
    const statuses = [a.status, b.status].sort();
    expect(statuses).toEqual([200, 409]);

    const winner = conv!.assigned_to_user_id as string;
    expect(["manish", "bijay"]).toContain(winner);
    expect(inserted).toHaveLength(1);
    expect(inserted[0].author_user_id).toBe(winner);

    const loser = a.status === 409 ? a : b;
    const json = await loser.json();
    expect(json.error.code).toBe("ALREADY_ACCEPTED");
    expect(json.error.details.owner_id).toBe(winner);
  });

  it("a chat whose owner was deleted can be accepted again", async () => {
    conv = { ...conv!, assignee_type: "human", assigned_to_user_id: null };
    const res = await call();
    expect(res.status).toBe(200);
    expect(conv!.assigned_to_user_id).toBe("manish");
  });

  it("does nothing for channels that don't need accepting (WhatsApp)", async () => {
    conv = { ...conv!, provider: "whatsapp" };
    const res = await call();
    expect(res.status).toBe(409);
    expect((await res.json()).error.code).toBe("NOT_CLAIMABLE");
    expect(conv!.assignee_type).toBe("unassigned");
    expect(inserted).toHaveLength(0);
  });

  it("never sends anything to the visitor: only a system note row is written, no provider call exists on this route", async () => {
    await call();
    expect(inserted.every((r) => r.author_type === "system")).toBe(true);
  });
});
