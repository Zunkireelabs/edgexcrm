import { describe, it, expect, vi, beforeEach } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";

// Who gets the bell when a customer message arrives. In-memory fake database; no network.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = Record<string, any>;

const adminsMock = vi.fn(async (): Promise<string[]> => ["admin-1"]);
vi.mock("@/lib/notifications", () => ({ getTenantAdminRecipients: () => adminsMock() }));

import { resolveInboundRecipients } from "./inbound-recipients";

let members: Row[];
let leadAssignedTo: string | null;
let leadQueried: boolean;

function fakeDb() {
  return {
    from(table: string) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const b: any = {
        select: () => b,
        eq: () => b,
        maybeSingle: async () => {
          if (table === "leads") {
            leadQueried = true;
            return { data: leadAssignedTo ? { assigned_to: leadAssignedTo } : null, error: null };
          }
          return { data: null, error: null };
        },
        then: (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) =>
          Promise.resolve({ data: table === "tenant_users" ? members : [], error: null }).then(res, rej),
      };
      return b;
    },
  } as unknown as SupabaseClient;
}

const hiddenPos = { permissions: { nav: { mode: "allow", keys: ["/leads"] }, leadScope: "own" } };
const inboxPos = { permissions: { nav: { mode: "allow", keys: ["/inbox"] }, leadScope: "own" } };

beforeEach(() => {
  adminsMock.mockClear().mockResolvedValue(["admin-1"]);
  leadAssignedTo = "lead-counsellor";
  leadQueried = false;
  members = [
    { user_id: "manish", role: "staff", suspended_at: null, positions: inboxPos },
    { user_id: "bijay", role: "staff", suspended_at: null, positions: null },
    { user_id: "sadin", role: "admin", suspended_at: null, positions: null },
    { user_id: "no-inbox", role: "staff", suspended_at: null, positions: hiddenPos },
    { user_id: "gone", role: "staff", suspended_at: "2026-11-01T00:00:00Z", positions: null },
  ];
});

const chat = (over: Row = {}) => ({
  tenantId: "t", provider: "chatwoot", assigneeType: "unassigned", assignedToUserId: null, leadId: "lead-1", ...over,
});

describe("website chat nobody has accepted yet", () => {
  it("alerts EVERYONE who can open the Inbox, and says it is waiting to accept", async () => {
    const out = await resolveInboundRecipients(fakeDb(), chat());
    expect(out.userIds.sort()).toEqual(["bijay", "manish", "sadin"]);
    expect(out.title).toBe("New website chat · waiting to accept");
  });
  it("skips people whose position hides the Inbox, and suspended members", async () => {
    const out = await resolveInboundRecipients(fakeDb(), chat());
    expect(out.userIds).not.toContain("no-inbox");
    expect(out.userIds).not.toContain("gone");
  });
  it("does not alert the lead's counsellor separately", async () => {
    const out = await resolveInboundRecipients(fakeDb(), chat());
    expect(out.userIds).not.toContain("lead-counsellor");
    expect(leadQueried).toBe(false);
  });
  it("a human owner whose user was deleted counts as nobody, so everyone is alerted again", async () => {
    const out = await resolveInboundRecipients(fakeDb(), chat({ assigneeType: "human", assignedToUserId: null }));
    expect(out.userIds.length).toBe(3);
  });
  it("falls back to the owners and admins if nobody can open the Inbox", async () => {
    members = [{ user_id: "x", role: "staff", suspended_at: null, positions: hiddenPos }];
    const out = await resolveInboundRecipients(fakeDb(), chat());
    expect(out.userIds).toEqual(["admin-1"]);
  });
});

describe("website chat someone has accepted", () => {
  const owned = chat({ assigneeType: "human", assignedToUserId: "manish" });

  it("alerts ONLY the owner, with the normal title", async () => {
    const out = await resolveInboundRecipients(fakeDb(), owned);
    expect(out.userIds).toEqual(["manish"]);
    expect(out.title).toBe("New message");
  });
  it("does not alert the lead's counsellor, admins, or anyone else", async () => {
    const out = await resolveInboundRecipients(fakeDb(), owned);
    expect(out.userIds).not.toContain("lead-counsellor");
    expect(out.userIds).not.toContain("admin-1");
    expect(out.userIds).not.toContain("bijay");
    expect(adminsMock).not.toHaveBeenCalled();
  });
});

describe("other channels are unchanged", () => {
  it("WhatsApp: the assigned human plus the lead's counsellor", async () => {
    const out = await resolveInboundRecipients(fakeDb(), chat({ provider: "whatsapp", assigneeType: "human", assignedToUserId: "manish" }));
    expect(out.userIds.sort()).toEqual(["lead-counsellor", "manish"]);
    expect(out.title).toBe("New message");
  });
  it("WhatsApp unassigned with no lead counsellor: falls back to admins, never to everyone", async () => {
    leadAssignedTo = null;
    const out = await resolveInboundRecipients(fakeDb(), chat({ provider: "whatsapp" }));
    expect(out.userIds).toEqual(["admin-1"]);
  });
  it("WhatsApp with no lead: just the assigned human", async () => {
    const out = await resolveInboundRecipients(fakeDb(), chat({ provider: "whatsapp", leadId: null, assigneeType: "human", assignedToUserId: "bijay" }));
    expect(out.userIds).toEqual(["bijay"]);
    expect(leadQueried).toBe(false);
  });
});
