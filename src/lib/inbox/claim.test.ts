import { describe, it, expect, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import {
  CLAIM_PROVIDERS,
  requiresClaim,
  ownerOf,
  canReply,
  displayNameFor,
  memberCanOpenInbox,
  writeSystemNote,
  replyLock,
} from "./claim";

// The "Accept this chat" rules. Pure functions plus small helpers over a fake Supabase client: no database.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = Record<string, any>;

describe("requiresClaim — which channels need accepting", () => {
  it("is website chat (chatwoot) only for now", () => {
    expect([...CLAIM_PROVIDERS]).toEqual(["chatwoot"]);
    expect(requiresClaim("chatwoot")).toBe(true);
  });
  it("leaves every other channel exactly as it is today", () => {
    for (const p of ["whatsapp", "messenger", "instagram", "email", "sandbox", "", null, undefined]) {
      expect(requiresClaim(p as string | null | undefined)).toBe(false);
    }
  });
});

describe("ownerOf", () => {
  it("is the assigned user when a human owns the chat", () => {
    expect(ownerOf({ assignee_type: "human", assigned_to_user_id: "u1" })).toBe("u1");
  });
  it("is nobody when unassigned", () => {
    expect(ownerOf({ assignee_type: "unassigned", assigned_to_user_id: null })).toBeNull();
  });
  it("treats a human assignee whose user was deleted as nobody, so the chat can be accepted again", () => {
    expect(ownerOf({ assignee_type: "human", assigned_to_user_id: null })).toBeNull();
  });
  it("is nobody when an AI agent is assigned (no human owner)", () => {
    expect(ownerOf({ assignee_type: "ai_agent", assigned_to_user_id: null })).toBeNull();
  });
  it("ignores a stale user id on an unassigned chat", () => {
    expect(ownerOf({ assignee_type: "unassigned", assigned_to_user_id: "u9" })).toBeNull();
  });
});

describe("canReply", () => {
  const chat = (over: Row = {}) => ({ provider: "chatwoot", assignee_type: "human", assigned_to_user_id: "owner", ...over });

  it("website chat: only the owner can reply", () => {
    expect(canReply(chat(), "owner")).toBe(true);
    expect(canReply(chat(), "someone-else")).toBe(false);
  });
  it("website chat nobody has accepted: nobody can reply yet", () => {
    expect(canReply(chat({ assignee_type: "unassigned", assigned_to_user_id: null }), "owner")).toBe(false);
  });
  it("an admin is not special for replying — they take over first", () => {
    expect(canReply(chat(), "admin-user")).toBe(false);
  });
  it("WhatsApp and other channels are unchanged: anyone who could reply before still can", () => {
    expect(canReply(chat({ provider: "whatsapp" }), "someone-else")).toBe(true);
    expect(canReply(chat({ provider: "whatsapp", assignee_type: "unassigned", assigned_to_user_id: null }), "x")).toBe(true);
  });
});

function adminDb(user: { user_metadata?: Row; email?: string } | null, opts: { throws?: boolean } = {}) {
  return {
    auth: {
      admin: {
        getUserById: async () => {
          if (opts.throws) throw new Error("auth down");
          return { data: { user } };
        },
      },
    },
  } as unknown as SupabaseClient;
}

describe("displayNameFor", () => {
  it("uses the profile name", async () => {
    expect(await displayNameFor(adminDb({ user_metadata: { name: "Manish Sah" } }), "u")).toBe("Manish Sah");
    expect(await displayNameFor(adminDb({ user_metadata: { full_name: "Bijay Dahal" } }), "u")).toBe("Bijay Dahal");
  });
  it("falls back to the part of the email before the @", async () => {
    expect(await displayNameFor(adminDb({ email: "manish.sah@admizz.com" }), "u")).toBe("manish.sah");
  });
  it("falls back to a neutral word when nothing is known, and never throws", async () => {
    expect(await displayNameFor(adminDb(null), "u")).toBe("a teammate");
    expect(await displayNameFor(adminDb(null, { throws: true }), "u")).toBe("a teammate");
  });
  it("strips angle brackets and control characters so a name can't inject markup into a note", async () => {
    const name = await displayNameFor(adminDb({ user_metadata: { name: "Ev<script>il\n\tName" } }), "u");
    expect(name).not.toMatch(/[<>\n\t]/);
  });
  it("caps a very long name", async () => {
    const name = await displayNameFor(adminDb({ user_metadata: { name: "A".repeat(500) } }), "u");
    expect(name.length).toBeLessThanOrEqual(60);
  });
});

function memberDb(row: Row | null) {
  return {
    from: () => ({
      select: () => ({ eq: () => ({ eq: () => ({ maybeSingle: async () => ({ data: row, error: null }) }) }) }),
    }),
  } as unknown as SupabaseClient;
}

describe("memberCanOpenInbox — same rule that hides the sidebar link", () => {
  it("owners and admins always can", async () => {
    expect(await memberCanOpenInbox(memberDb({ role: "owner", suspended_at: null, positions: null }), "t", "u")).toBe(true);
    expect(await memberCanOpenInbox(memberDb({ role: "admin", suspended_at: null, positions: null }), "t", "u")).toBe(true);
  });
  it("a member whose position allows /inbox can", async () => {
    const positions = { permissions: { nav: { mode: "allow", keys: ["/inbox", "/leads"] }, leadScope: "own" } };
    expect(await memberCanOpenInbox(memberDb({ role: "staff", suspended_at: null, positions }), "t", "u")).toBe(true);
  });
  it("a member whose position hides the Inbox can't", async () => {
    const positions = { permissions: { nav: { mode: "allow", keys: ["/leads"] }, leadScope: "own" } };
    expect(await memberCanOpenInbox(memberDb({ role: "staff", suspended_at: null, positions }), "t", "u")).toBe(false);
  });
  it("a member with no position and no page restriction can (today's default)", async () => {
    expect(await memberCanOpenInbox(memberDb({ role: "staff", suspended_at: null, positions: null }), "t", "u")).toBe(true);
  });
  it("a suspended member can't, and neither can someone who isn't in this team", async () => {
    expect(await memberCanOpenInbox(memberDb({ role: "admin", suspended_at: "2026-11-01T00:00:00Z", positions: null }), "t", "u")).toBe(false);
    expect(await memberCanOpenInbox(memberDb(null), "t", "u")).toBe(false);
  });
});

describe("writeSystemNote — team-only notes", () => {
  it("writes a system-authored row straight into messages (never through the provider send path)", async () => {
    const insert = vi.fn(async (row: Row) => {
      void row;
      return { error: null };
    });
    const db = { from: (t: string) => (t === "messages" ? { insert } : (() => { throw new Error("unexpected table " + t); })()) } as unknown as SupabaseClient;
    await writeSystemNote(db, { tenantId: "t1", conversationId: "c1", channelId: "ch1", userId: "u1", text: "Manish accepted this chat" });
    expect(insert).toHaveBeenCalledWith({
      tenant_id: "t1",
      conversation_id: "c1",
      channel_id: "ch1",
      direction: "outbound",
      author_type: "system",
      author_user_id: "u1",
      content_text: "Manish accepted this chat",
      status: "sent",
    });
  });
  it("never throws if the note can't be saved (the ownership change already happened)", async () => {
    const db = { from: () => ({ insert: async () => ({ error: { message: "db down" } }) }) } as unknown as SupabaseClient;
    await expect(writeSystemNote(db, { tenantId: "t", conversationId: "c", channelId: "ch", userId: null, text: "x" })).resolves.toBeUndefined();
  });
});

describe("replyLock", () => {
  const db = adminDb({ user_metadata: { name: "Manish" } });

  it("lets the owner through (null = no lock)", async () => {
    expect(await replyLock(db, { provider: "chatwoot", assignee_type: "human", assigned_to_user_id: "me" }, "me")).toBeNull();
  });
  it("lets every other channel through unchanged", async () => {
    expect(await replyLock(db, { provider: "whatsapp", assignee_type: "unassigned", assigned_to_user_id: null }, "anyone")).toBeNull();
  });
  it("refuses a non-owner with 403 and names who is handling the chat", async () => {
    const res = await replyLock(db, { provider: "chatwoot", assignee_type: "human", assigned_to_user_id: "owner" }, "other");
    expect(res!.status).toBe(403);
    const json = await res!.json();
    expect(json.error.code).toBe("NOT_CHAT_OWNER");
    expect(json.error.message).toContain("Manish is handling this chat");
  });
  it("refuses everyone on a chat nobody accepted, and says to accept it", async () => {
    const res = await replyLock(db, { provider: "chatwoot", assignee_type: "unassigned", assigned_to_user_id: null }, "other");
    expect(res!.status).toBe(403);
    expect((await res!.json()).error.message).toContain("Accept it to reply");
  });
});

// ---- who can be alerted / handed a chat ----

import { listInboxMemberIds, inboxMemberDirectory } from "./claim";

function directoryDb(members: Row[], users: Row[]) {
  return {
    auth: { admin: { listUsers: async () => ({ data: { users } }) } },
    from: () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const b: any = {
        select: () => b,
        eq: () => b,
        then: (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) => Promise.resolve({ data: members, error: null }).then(res, rej),
      };
      return b;
    },
  } as unknown as SupabaseClient;
}

describe("listInboxMemberIds / inboxMemberDirectory", () => {
  const members = [
    { user_id: "a", role: "staff", suspended_at: null, positions: null },
    { user_id: "b", role: "staff", suspended_at: null, positions: { permissions: { nav: { mode: "allow", keys: ["/leads"] }, leadScope: "own" } } },
    { user_id: "c", role: "owner", suspended_at: "2026-11-01T00:00:00Z", positions: null },
    { user_id: "d", role: "admin", suspended_at: null, positions: null },
  ];
  it("lists exactly the members who can open the Inbox", async () => {
    expect((await listInboxMemberIds(directoryDb(members, []), "t")).sort()).toEqual(["a", "d"]);
  });
  it("returns an empty list (and skips the user lookup) when nobody can", async () => {
    const db = directoryDb([members[1], members[2]], []);
    expect(await listInboxMemberIds(db, "t")).toEqual([]);
    expect(await inboxMemberDirectory(db, "t")).toEqual([]);
  });
  it("names them from their profile, else the email's first part, sorted, and ignores users from other teams", async () => {
    const users = [
      { id: "d", email: "zed@x.com", user_metadata: { name: "Adam Admin" } },
      { id: "a", email: "bob.smith@x.com", user_metadata: {} },
      { id: "stranger", email: "s@x.com", user_metadata: { name: "Stranger" } },
    ];
    expect(await inboxMemberDirectory(directoryDb(members, users), "t")).toEqual([
      { user_id: "d", name: "Adam Admin" },
      { user_id: "a", name: "bob.smith" },
    ]);
  });
});

import { chatChangeLock } from "./claim";

describe("chatChangeLock — who may change (not just reply on) a website chat", () => {
  const db = adminDb({ user_metadata: { name: "Manish" } });
  const chat = (over: Row = {}) => ({ provider: "chatwoot", assignee_type: "human", assigned_to_user_id: "owner", ...over });

  it("lets the owner and any admin through (null = no lock)", async () => {
    expect(await chatChangeLock(db, chat(), "owner", false)).toBeNull();
    expect(await chatChangeLock(db, chat(), "someone", true)).toBeNull();
  });
  it("refuses anyone else on a chat someone is handling, naming the owner", async () => {
    const res = await chatChangeLock(db, chat(), "other", false);
    expect(res!.status).toBe(403);
    const json = await res!.json();
    expect(json.error.code).toBe("NOT_CHAT_OWNER");
    expect(json.error.message).toContain("Manish is handling this chat");
  });
  it("on a chat nobody has accepted, a normal teammate must accept it first; an admin may change it", async () => {
    const unowned = chat({ assignee_type: "unassigned", assigned_to_user_id: null });
    const res = await chatChangeLock(db, unowned, "other", false);
    expect(res!.status).toBe(403);
    expect((await res!.json()).error.message).toContain("Accept this chat first");
    expect(await chatChangeLock(db, unowned, "admin-user", true)).toBeNull();
  });
  it("other channels are never locked", async () => {
    expect(await chatChangeLock(db, chat({ provider: "whatsapp" }), "other", false)).toBeNull();
  });
});
