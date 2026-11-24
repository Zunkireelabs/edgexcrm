import { describe, it, expect, vi, beforeEach } from "vitest";
import type { AuthContext } from "@/lib/api/auth";

// GET /inbox/handover-targets — the people a website chat can be handed to.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = Record<string, any>;

const authMock = vi.fn();
let members: Row[];
let users: Row[];

vi.mock("@/lib/api/auth", () => ({ authenticateRequest: () => authMock() }));
vi.mock("@/lib/supabase/server", () => ({
  createServiceClient: async () => ({
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
  }),
}));

import { GET } from "./route";

const AUTH = (nav: string[] | null): AuthContext =>
  ({ userId: "u1", tenantId: "t", role: "staff", permissions: { allowedNavKeys: nav === null ? null : new Set(nav) } }) as unknown as AuthContext;

beforeEach(() => {
  authMock.mockReset().mockResolvedValue(AUTH(null));
  members = [
    { user_id: "bijay", role: "staff", suspended_at: null, positions: null },
    { user_id: "manish", role: "staff", suspended_at: null, positions: null },
    { user_id: "hidden", role: "staff", suspended_at: null, positions: { permissions: { nav: { mode: "allow", keys: ["/leads"] }, leadScope: "own" } } },
    { user_id: "gone", role: "admin", suspended_at: "2026-11-01T00:00:00Z", positions: null },
  ];
  users = [
    { id: "manish", email: "manish@x.com", user_metadata: { name: "Manish Sah" } },
    { id: "bijay", email: "bijay.dahal@x.com", user_metadata: {} },
    { id: "hidden", email: "h@x.com", user_metadata: { name: "Hidden" } },
    { id: "gone", email: "g@x.com", user_metadata: { name: "Gone" } },
    { id: "other-tenant", email: "o@x.com", user_metadata: { name: "Other Tenant" } },
  ];
});

describe("GET /inbox/handover-targets", () => {
  it("401s without a session, 403s someone who can't open the Inbox", async () => {
    authMock.mockResolvedValue(null);
    expect((await GET()).status).toBe(401);
    authMock.mockResolvedValue(AUTH(["/leads"]));
    expect((await GET()).status).toBe(403);
  });

  it("lists only team members who can open the Inbox, with readable names, sorted", async () => {
    const res = await GET();
    expect(res.status).toBe(200);
    expect((await res.json()).data).toEqual([
      { user_id: "bijay", name: "bijay.dahal" }, // no profile name: falls back to the email's first part
      { user_id: "manish", name: "Manish Sah" },
    ]);
  });

  it("never offers someone hidden from the Inbox, suspended, or from another team", async () => {
    const ids = ((await (await GET()).json()).data as { user_id: string }[]).map((m) => m.user_id);
    expect(ids).not.toContain("hidden");
    expect(ids).not.toContain("gone");
    expect(ids).not.toContain("other-tenant");
  });
});
