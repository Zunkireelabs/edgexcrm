import { describe, it, expect, vi, beforeEach } from "vitest";
import type { AuthContext } from "@/lib/api/auth";
import { resolvePermissions, type PositionPermissions } from "@/lib/api/permissions";

// GET /inbox/conversations — what each kind of viewer's LIST contains. A counsellor sees the conversations on leads they
// can see plus every website chat; an admin sees everything exactly as before.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = Record<string, any>;

const authMock = vi.fn();
let visibleIds: string[];
let calls: { method: string; args: unknown[] }[];
let candidateRows: Row[];

vi.mock("@/lib/api/auth", () => ({ authenticateRequest: () => authMock() }));
vi.mock("@/lib/inbox/scope", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/inbox/scope")>()),
  visibleLeadIdsAmong: async () => visibleIds,
}));
vi.mock("@/lib/supabase/server", () => ({
  createClient: async () => ({}),
  createServiceClient: async () => ({
    from: () => {
      let isCandidate = false;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const b: any = {
        select: (cols: string) => ((isCandidate = cols === "lead_id"), b),
        order: () => b,
        range: () => b,
        eq: () => b,
        not: () => b,
        in: (...a: unknown[]) => (calls.push({ method: "in", args: a }), b),
        or: (...a: unknown[]) => (calls.push({ method: "or", args: a }), b),
        then: (res: (v: unknown) => unknown, rej: (e: unknown) => unknown) =>
          Promise.resolve({ data: isCandidate ? candidateRows : [{ id: "c1" }], error: null }).then(res, rej),
      };
      return b;
    },
  }),
}));

import { GET } from "./route";

const counsellor = (nav: string[] | null): AuthContext =>
  ({
    userId: "u1", tenantId: "t", role: "staff", branchId: null,
    permissions: resolvePermissions("staff", { leadScope: "own", ...(nav ? { nav: { mode: "allow", keys: nav } } : {}) } as unknown as PositionPermissions),
  }) as unknown as AuthContext;
const admin = (): AuthContext =>
  ({ userId: "a1", tenantId: "t", role: "admin", branchId: null, permissions: resolvePermissions("admin", null) }) as unknown as AuthContext;

const call = () => GET({ url: "http://x/api/v1/inbox/conversations" } as never);

beforeEach(() => {
  calls = [];
  visibleIds = [];
  candidateRows = [{ lead_id: "l1" }];
  authMock.mockReset();
});

describe("GET /inbox/conversations — who sees what", () => {
  it("a counsellor gets the conversations on leads they can see PLUS every website chat", async () => {
    authMock.mockResolvedValue(counsellor(["/inbox"]));
    visibleIds = ["l1", "l2"];
    const res = await call();
    expect(res.status).toBe(200);
    expect(calls).toEqual([{ method: "or", args: ["lead_id.in.(l1,l2),provider.in.(chatwoot)"] }]);
  });

  it("a counsellor with no visible leads still sees website chats (the list is not empty)", async () => {
    authMock.mockResolvedValue(counsellor(["/inbox"]));
    visibleIds = [];
    const res = await call();
    expect((await res.json()).data).toEqual([{ id: "c1" }]);
    expect(calls).toEqual([{ method: "or", args: ["provider.in.(chatwoot)"] }]);
  });

  it("someone whose position hides the Inbox and who has no visible leads gets an empty list, no query", async () => {
    authMock.mockResolvedValue(counsellor(["/leads"]));
    visibleIds = [];
    const res = await call();
    expect((await res.json()).data).toEqual([]);
    expect(calls).toHaveLength(0);
  });

  it("someone whose position hides the Inbox only gets their lead conversations, never website chats", async () => {
    authMock.mockResolvedValue(counsellor(["/leads"]));
    visibleIds = ["l1"];
    await call();
    expect(calls).toEqual([{ method: "or", args: ["lead_id.in.(l1)"] }]);
  });

  it("owners and admins are unrestricted: no extra filter at all, exactly as before", async () => {
    authMock.mockResolvedValue(admin());
    const res = await call();
    expect(res.status).toBe(200);
    expect(calls).toHaveLength(0);
  });
});
