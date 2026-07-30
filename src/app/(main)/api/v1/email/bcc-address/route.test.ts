import { describe, it, expect, vi, beforeEach } from "vitest";
import type { AuthContext } from "@/lib/api/auth";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = Record<string, any>;

const authenticateRequestMock = vi.fn();
const getFeatureAccessMock = vi.fn(() => true);
const scopedClientMock = vi.fn();
const checkRateLimitMock = vi.fn(async (key: string, config: unknown) => {
  void key;
  void config;
  return { allowed: true, remaining: 10, limit: 5, resetAt: 0, retryAfterSeconds: 0 };
});
const mintTokenMock = vi.fn((verb: string) => {
  void verb;
  return {
    token: "mintedtoken123",
    checksum: "chk123",
    localPart: "bcc+sminted123checksum",
    address: "bcc+sminted123checksum@inbound.edgex.zunkireelabs.com",
  };
});
const buildInboundAddressMock = vi.fn(
  (verb: string, token: string) => `${verb}+s${token}rebuilt@inbound.edgex.zunkireelabs.com`,
);

vi.mock("@/lib/api/auth", () => ({ authenticateRequest: authenticateRequestMock }));
vi.mock("@/industries/_loader", () => ({ getFeatureAccess: getFeatureAccessMock }));
vi.mock("@/lib/supabase/scoped", () => ({ scopedClient: scopedClientMock }));
vi.mock("@/lib/api/rate-limit", () => ({
  checkRateLimit: (key: string, config: unknown) => checkRateLimitMock(key, config),
  BCC_REGENERATE_LIMIT: { maxRequests: 5, windowMs: 300_000 },
}));
vi.mock("@/lib/email/inbound/tokens", () => ({
  mintToken: (verb: string) => mintTokenMock(verb),
  buildInboundAddress: (verb: string, token: string) => buildInboundAddressMock(verb, token),
}));

const FAKE_AUTH = {
  userId: "user-1",
  email: "rep@zunkireelabs.com",
  tenantId: "tenant-a",
  role: "counselor",
  industryId: "it_agency",
  permissions: {},
} as unknown as AuthContext;

interface FakeDbOptions {
  inboundEnabled?: boolean;
  existingDropbox?: Row | null;
  forceInsertError?: { code: string; message: string } | null;
}

function makeDb(opts: FakeDbOptions = {}) {
  const { inboundEnabled = true, existingDropbox = null, forceInsertError = null } = opts;
  const insertedRows: Row[] = [];
  const updatedFilters: Array<[string, unknown][]> = [];

  function from(table: string) {
    if (table === "tenant_email_settings") {
      return { select: () => ({ maybeSingle: async () => ({ data: { inbound_enabled: inboundEnabled }, error: null }) }) };
    }
    if (table === "inbound_addresses") {
      const filters: Array<[string, unknown]> = [];
      const builder = {
        eq(col: string, val: unknown) {
          filters.push([col, val]);
          return builder;
        },
        select() {
          return builder;
        },
        maybeSingle: async () => ({ data: existingDropbox, error: null }),
        insert(payload: Row) {
          if (forceInsertError) return { error: forceInsertError };
          insertedRows.push(payload);
          return { error: null };
        },
        update(payload: Row) {
          const updateBuilder = {
            eq(col: string, val: unknown) {
              filters.push([col, val]);
              return updateBuilder;
            },
            then(resolve: (v: { data: unknown; error: unknown }) => void) {
              updatedFilters.push([...filters]);
              void payload;
              Promise.resolve({ data: null, error: null }).then(resolve);
            },
          };
          return updateBuilder;
        },
      };
      return builder;
    }
    throw new Error(`unexpected table in test: ${table}`);
  }

  return { db: { from }, insertedRows, updatedFilters };
}

beforeEach(() => {
  authenticateRequestMock.mockReset().mockResolvedValue(FAKE_AUTH);
  getFeatureAccessMock.mockReset().mockReturnValue(true);
  checkRateLimitMock.mockReset().mockResolvedValue({ allowed: true, remaining: 4, limit: 5, resetAt: 0, retryAfterSeconds: 0 });
  mintTokenMock.mockReset().mockReturnValue({
    token: "mintedtoken123",
    checksum: "chk123",
    localPart: "bcc+sminted123checksum",
    address: "bcc+sminted123checksum@inbound.edgex.zunkireelabs.com",
  });
  buildInboundAddressMock.mockReset().mockImplementation((verb: string, token: string) => `${verb}+s${token}rebuilt@inbound.edgex.zunkireelabs.com`);
  process.env.EDGEX_INBOUND_ENABLED = "true";
});

describe("GET /api/v1/email/bcc-address", () => {
  it("404s when EDGEX_INBOUND_ENABLED is off — the double gate", async () => {
    process.env.EDGEX_INBOUND_ENABLED = "false";
    const { db } = makeDb({ inboundEnabled: true });
    scopedClientMock.mockResolvedValue(db);

    const { GET } = await import("./route");
    const res = await GET();
    expect(res.status).toBe(404);
  });

  it("404s when the tenant hasn't opted into inbound", async () => {
    const { db } = makeDb({ inboundEnabled: false });
    scopedClientMock.mockResolvedValue(db);

    const { GET } = await import("./route");
    const res = await GET();
    expect(res.status).toBe(404);
  });

  it("returns the caller's existing active dropbox without minting a new one", async () => {
    const { db, insertedRows } = makeDb({ existingDropbox: { id: "addr-1", token: "existingtoken" } });
    scopedClientMock.mockResolvedValue(db);

    const { GET } = await import("./route");
    const res = await GET();
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.data.address).toBe("bcc+sexistingtokenrebuilt@inbound.edgex.zunkireelabs.com");
    expect(insertedRows).toHaveLength(0); // no mint when one already exists
  });

  it("mints on first call when no active dropbox exists yet", async () => {
    const { db, insertedRows } = makeDb({ existingDropbox: null });
    scopedClientMock.mockResolvedValue(db);

    const { GET } = await import("./route");
    const res = await GET();
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.data.address).toBe("bcc+sminted123checksum@inbound.edgex.zunkireelabs.com");
    expect(insertedRows).toHaveLength(1);
    expect(insertedRows[0]).toMatchObject({ kind: "user", verb: "bcc", user_id: "user-1", status: "active" });
  });
});

describe("POST /api/v1/email/bcc-address (regenerate)", () => {
  it("404s when the double gate is off", async () => {
    process.env.EDGEX_INBOUND_ENABLED = "false";
    const { db } = makeDb();
    scopedClientMock.mockResolvedValue(db);

    const { POST } = await import("./route");
    const res = await POST();
    expect(res.status).toBe(404);
  });

  it("429s when the regenerate rate limit is hit", async () => {
    checkRateLimitMock.mockResolvedValue({ allowed: false, remaining: 0, limit: 5, resetAt: 0, retryAfterSeconds: 42 });
    const { db } = makeDb();
    scopedClientMock.mockResolvedValue(db);

    const { POST } = await import("./route");
    const res = await POST();
    expect(res.status).toBe(429);
  });

  it("revokes the old address before minting the new one, scoped to this caller only", async () => {
    const { db, insertedRows, updatedFilters } = makeDb();
    scopedClientMock.mockResolvedValue(db);

    const { POST } = await import("./route");
    const res = await POST();
    const json = await res.json();

    expect(res.status).toBe(200);
    expect(json.data.address).toBe("bcc+sminted123checksum@inbound.edgex.zunkireelabs.com");
    expect(insertedRows).toHaveLength(1);
    expect(insertedRows[0]).toMatchObject({ kind: "user", verb: "bcc", user_id: "user-1", status: "active" });

    // The revoke must be scoped to (kind='user', verb='bcc', user_id=caller, status='active')
    // — never another user's row, regardless of role.
    expect(updatedFilters).toHaveLength(1);
    const revokeFilters = Object.fromEntries(updatedFilters[0]);
    expect(revokeFilters).toMatchObject({ kind: "user", verb: "bcc", user_id: "user-1", status: "active" });
  });
});
