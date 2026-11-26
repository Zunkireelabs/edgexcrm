import { describe, it, expect, vi, beforeEach } from "vitest";
import type { AuthContext } from "@/lib/api/auth";
import { resolvePermissions, type PositionPermissions } from "@/lib/api/permissions";

// GET /inbox/conversations/[id] — website chats are readable by every Inbox user, but the linked lead's name, email and
// phone must not leak to someone who couldn't see that lead before.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = Record<string, any>;

const authMock = vi.fn();
let conv: Row;
let visibleLeadIds: string[];

vi.mock("@/lib/api/auth", () => ({ authenticateRequest: () => authMock(), requireAdmin: (a: { role: string }) => a.role === "owner" || a.role === "admin" }));
vi.mock("@/lib/leads/visibility-query", () => ({
  visibleLeadsBase: () => ({ select: () => ({ is: () => ({ in: async () => ({ data: visibleLeadIds.map((id) => ({ id })) }) }) }) }),
}));
vi.mock("@/lib/notifications", () => ({ createNotification: async () => {}, NotificationTypes: { INBOX_ASSIGNED: "inbox.assigned" } }));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({}),
  createServiceClient: async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const b: any = { select: () => b, eq: () => b, maybeSingle: async () => ({ data: { ...conv }, error: null }) };
    return { from: () => b };
  },
}));

import { GET } from "./route";

const counsellor = (): AuthContext =>
  ({
    userId: "u1", tenantId: "t", role: "staff", branchId: null,
    permissions: resolvePermissions("staff", { leadScope: "own", nav: { mode: "allow", keys: ["/inbox"] } } as unknown as PositionPermissions),
  }) as unknown as AuthContext;
const admin = (): AuthContext =>
  ({ userId: "a1", tenantId: "t", role: "admin", branchId: null, permissions: resolvePermissions("admin", null) }) as unknown as AuthContext;

const call = () => GET({} as never, { params: Promise.resolve({ id: "conv-1" }) });

beforeEach(() => {
  visibleLeadIds = [];
  conv = {
    id: "conv-1", provider: "chatwoot", lead_id: "lead-1", contact_display_name: "Ram Sharma", status: "open",
    leads: { id: "lead-1", first_name: "Ram", last_name: "S", email: "ram@lead.com", phone: "+977980000000" },
  };
  authMock.mockReset().mockResolvedValue(counsellor());
});

describe("GET /inbox/conversations/[id] — linked lead privacy", () => {
  it("a counsellor can read a website chat linked to someone else's lead, WITHOUT that lead's details", async () => {
    const res = await call();
    expect(res.status).toBe(200);
    const data = (await res.json()).data;
    expect(data.contact_display_name).toBe("Ram Sharma"); // the chat itself is readable
    expect(data.leads).toBeNull(); // the lead's name / email / phone are not
    expect(JSON.stringify(data)).not.toContain("ram@lead.com");
    expect(JSON.stringify(data)).not.toContain("+977980000000");
  });

  it("a counsellor sees the lead's details when it is THEIR lead", async () => {
    visibleLeadIds = ["lead-1"];
    const data = (await (await call()).json()).data;
    expect(data.leads).toMatchObject({ email: "ram@lead.com" });
  });

  it("admins always see the lead's details", async () => {
    authMock.mockResolvedValue(admin());
    expect((await (await call()).json()).data.leads).toMatchObject({ email: "ram@lead.com" });
  });

  it("a chat with no linked lead is returned as is", async () => {
    conv = { ...conv, lead_id: null, leads: null };
    const res = await call();
    expect(res.status).toBe(200);
  });

  it("other channels are unchanged: a counsellor still gets 403 on a WhatsApp chat linked to someone else's lead", async () => {
    conv = { ...conv, provider: "whatsapp" };
    expect((await call()).status).toBe(403);
  });
});
