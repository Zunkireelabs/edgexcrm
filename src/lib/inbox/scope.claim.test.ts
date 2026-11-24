import { describe, it, expect } from "vitest";
import { canAccessConversationLead, restrictedConversationFilter, type InboxScopeAuth, type InboxScopeClients } from "./scope";
import { resolvePermissions, type PositionPermissions } from "@/lib/api/permissions";

// Website chats are readable by EVERY Inbox user (so the first free person can see and accept one); other channels keep
// the lead rules. A restricted viewer here is a counsellor: leadScope "own".

const clients = { user: {}, service: {} } as unknown as InboxScopeClients;

const own = (navKeys: string[] | null): InboxScopeAuth => ({
  tenantId: "t",
  userId: "u1",
  branchId: null,
  permissions: resolvePermissions("staff", {
    leadScope: "own",
    ...(navKeys ? { nav: { mode: "allow", keys: navKeys } } : {}),
  } as unknown as PositionPermissions),
});
const admin = (): InboxScopeAuth => ({ tenantId: "t", userId: "a1", branchId: null, permissions: resolvePermissions("admin", null) });

describe("canAccessConversationLead — website chats", () => {
  it("a counsellor who can open the Inbox may read a website chat even though it isn't on their lead (unlinked)", async () => {
    expect(await canAccessConversationLead(clients, own(["/inbox"]), null, "chatwoot")).toBe(true);
  });
  it("…whoever the lead belongs to (linked to someone else's lead)", async () => {
    expect(await canAccessConversationLead(clients, own(["/inbox"]), "someone-elses-lead", "chatwoot")).toBe(true);
  });
  it("a counsellor whose position hides the Inbox gets no extra access", async () => {
    expect(await canAccessConversationLead(clients, own(["/leads"]), null, "chatwoot")).toBe(false);
  });
  it("other channels keep today's rule: an unlinked WhatsApp conversation stays hidden from a counsellor", async () => {
    expect(await canAccessConversationLead(clients, own(["/inbox"]), null, "whatsapp")).toBe(false);
    expect(await canAccessConversationLead(clients, own(["/inbox"]), null)).toBe(false);
  });
  it("owners and admins are unrestricted, as before", async () => {
    expect(await canAccessConversationLead(clients, admin(), null, "whatsapp")).toBe(true);
    expect(await canAccessConversationLead(clients, admin(), null, "chatwoot")).toBe(true);
  });
});

describe("restrictedConversationFilter", () => {
  it("leads they can see PLUS every website chat", () => {
    expect(restrictedConversationFilter(["l1", "l2"], true)).toBe("lead_id.in.(l1,l2),provider.in.(chatwoot)");
  });
  it("with no visible leads they still see website chats (not an empty list)", () => {
    expect(restrictedConversationFilter([], true)).toBe("provider.in.(chatwoot)");
  });
  it("without Inbox access, only their leads", () => {
    expect(restrictedConversationFilter(["l1"], false)).toBe("lead_id.in.(l1)");
  });
  it("nothing to show means null so the caller can skip the query", () => {
    expect(restrictedConversationFilter([], false)).toBeNull();
  });
});
