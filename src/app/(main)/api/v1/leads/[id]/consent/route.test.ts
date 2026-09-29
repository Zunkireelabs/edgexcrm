import { describe, it, expect, vi, beforeEach } from "vitest";
import type { NextRequest } from "next/server";
import type { AuthContext } from "@/lib/api/auth";

// No database: every Supabase client is a hand-rolled fake. These tests pin the rule behind a
// production bug — a lead whose consent is signed must never be reported (or re-created) as unsigned.

const authenticateRequestMock = vi.fn();
const scopedClientMock = vi.fn();
const sendConsentEmailMock = vi.fn();

vi.mock("@/lib/api/auth", async () => {
  const actual = await vi.importActual<typeof import("@/lib/api/auth")>("@/lib/api/auth");
  return {
    ...actual,
    authenticateRequest: authenticateRequestMock,
    requireLeadBranchAccess: () => true,
    getClientIp: () => "127.0.0.1",
  };
});
vi.mock("@/lib/supabase/scoped", () => ({ scopedClient: scopedClientMock }));
vi.mock("@/lib/supabase/server", () => ({ createServiceClient: async () => serviceClient() }));
vi.mock("@/industries/_loader", () => ({ getFeatureAccess: () => true }));
vi.mock("@/lib/leads/branch-membership", () => ({ getLeadMembership: async () => [] }));
vi.mock("@/lib/api/permissions", () => ({ shouldRestrictToSelf: () => false, canManageApplications: () => true }));
vi.mock("@/lib/api/audit", () => ({ createAuditLog: vi.fn(), emitEvent: vi.fn() }));
vi.mock("@/lib/email/send-consent", () => ({ sendConsentEmail: sendConsentEmailMock }));
vi.mock("@/lib/email", () => ({ APP_URL: "https://crm.test" }));
vi.mock("@/lib/leads/touch-updated-at", () => ({ touchLeadUpdatedAt: vi.fn() }));

const LEAD = { id: "lead-1", assigned_to: "user-1", branch_id: null, email: "s@example.com", first_name: "S", last_name: "T", phone: "1", city: "K", country: "NP" };
let currentLead: Record<string, unknown> = LEAD;

function authAs(): AuthContext {
  return { userId: "user-1", tenantId: "tenant-1", industryId: "education_consultancy", role: "admin", permissions: {} } as unknown as AuthContext;
}

function serviceClient() {
  const t: Record<string, unknown> = {};
  t.select = vi.fn(() => t);
  t.eq = vi.fn(() => t);
  t.is = vi.fn(() => t);
  t.single = vi.fn(async () => ({ data: currentLead }));
  return { from: vi.fn(() => t) };
}

const row = (over: Record<string, unknown>) => ({
  id: "r", status: "sent", method: null, token: null, signer_name: null, signed_at: null,
  document_url: null, link_expires_at: null, sent_at: null, sent_via: null, ...over,
});

/**
 * consent_templates + lead_consents fakes. `records` is every non-deleted row (newest first).
 * The lead_consents fake honours `.eq()` filters and `.limit(n)`, so a query for "the latest row"
 * really returns only the newest one and a query for `status = signed` returns only signed rows —
 * that is what makes these tests fail against the old "newest row only" code.
 */
function fakeDb(records: ReturnType<typeof row>[]) {
  const writes = vi.fn();
  const template = {
    select: vi.fn(() => template),
    maybeSingle: vi.fn(async () => ({ data: { is_active: true, id: "tpl", body: "b", version: 1, link_expiry_days: 7, title: "t" } })),
  };
  const consentsTable = () => {
    const filters: Record<string, unknown> = {};
    const matching = () =>
      records.filter((r) =>
        Object.entries(filters).every(([col, val]) => !(col in r) || (r as Record<string, unknown>)[col] === val)
      );
    const t: Record<string, unknown> = {};
    t.select = vi.fn(() => t);
    t.eq = vi.fn((col: string, val: unknown) => { filters[col] = val; return t; });
    t.neq = vi.fn(() => t);
    t.is = vi.fn(() => t);
    t.order = vi.fn(() => t);
    t.limit = vi.fn((n: number) => {
      const rows = matching().slice(0, n);
      const result: Promise<{ data: unknown }> & { maybeSingle?: () => Promise<{ data: unknown }> } = Promise.resolve({ data: rows });
      result.maybeSingle = async () => ({ data: rows[0] ?? null });
      return result;
    });
    let inserted: Record<string, unknown> | null = null;
    t.insert = vi.fn((row: Record<string, unknown>) => { writes(row); inserted = row; return t; });
    t.update = vi.fn((...args: unknown[]) => { writes(...args); return t; });
    t.single = vi.fn(async () => ({ data: inserted ? { id: "new-consent", ...inserted } : null, error: null }));
    return t;
  };
  return {
    db: {
      from: vi.fn((name: string) => {
        if (name === "consent_templates") return template;
        if (name === "lead_consents") return consentsTable();
        throw new Error(`unexpected table: ${name}`);
      }),
    },
    writes,
  };
}

function params() {
  return { params: Promise.resolve({ id: "lead-1" }) };
}
function post(action: string, extra: Record<string, unknown> = {}): NextRequest {
  return { json: async () => ({ action, ...extra }) } as unknown as NextRequest;
}

beforeEach(() => {
  authenticateRequestMock.mockReset();
  scopedClientMock.mockReset();
  authenticateRequestMock.mockResolvedValue(authAs());
  sendConsentEmailMock.mockReset();
  sendConsentEmailMock.mockResolvedValue({ success: true });
  currentLead = LEAD;
});

describe("GET /api/v1/leads/[id]/consent", () => {
  it("reports SIGNED even when a newer 'sent' row sits next to the signed one", async () => {
    const { db } = fakeDb([row({ id: "newer-sent", status: "sent", token: "tok" }), row({ id: "signed-1", status: "signed", signer_name: "Student" })]);
    scopedClientMock.mockResolvedValue(db);

    const { GET } = await import("./route");
    const res = await GET({} as NextRequest, params());
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.data.status).toBe("signed");
    expect(body.data.record.id).toBe("signed-1");
    expect(body.data.link).toBeNull();
  });

  it("reports SENT with the signing link when nothing is signed yet", async () => {
    const { db } = fakeDb([row({ id: "sent-1", status: "sent", token: "tok", link_expires_at: "2999-01-01T00:00:00Z" })]);
    scopedClientMock.mockResolvedValue(db);

    const { GET } = await import("./route");
    const body = await (await GET({} as NextRequest, params())).json();

    expect(body.data.status).toBe("sent");
    expect(body.data.link).toBe("https://crm.test/consent/tok");
  });

  it("reports NONE when the lead has no consent record", async () => {
    const { db } = fakeDb([]);
    scopedClientMock.mockResolvedValue(db);

    const { GET } = await import("./route");
    const body = await (await GET({} as NextRequest, params())).json();

    expect(body.data.status).toBe("none");
    expect(body.data.record).toBeNull();
  });
});

describe("POST /api/v1/leads/[id]/consent", () => {
  it.each(["send", "send_in_person"])("refuses '%s' with 409 ALREADY_SIGNED and creates or deletes nothing", async (action) => {
    const { db, writes } = fakeDb([row({ id: "signed-1", status: "signed" })]);
    scopedClientMock.mockResolvedValue(db);

    const { POST } = await import("./route");
    const res = await POST(post(action), params());
    const body = await res.json();

    expect(res.status).toBe(409);
    expect(body.error.code).toBe("ALREADY_SIGNED");
    expect(writes).not.toHaveBeenCalled();
  });
});

describe("POST /api/v1/leads/[id]/consent — delivery (action: send)", () => {
  it("emails the link by default when the lead has an email (unchanged behaviour)", async () => {
    const { db } = fakeDb([]);
    scopedClientMock.mockResolvedValue(db);

    const { POST } = await import("./route");
    const res = await POST(post("send"), params());
    const body = await res.json();

    expect(res.status).toBe(201);
    expect(body.data.sent_via).toBe("email");
    expect(body.data.link).toMatch(/^https:\/\/crm\.test\/consent\/.+/);
    expect(sendConsentEmailMock).toHaveBeenCalledTimes(1);
  });

  it("emails the link with an explicit deliver: 'email'", async () => {
    const { db } = fakeDb([]);
    scopedClientMock.mockResolvedValue(db);

    const { POST } = await import("./route");
    const res = await POST(post("send", { deliver: "email" }), params());

    expect(res.status).toBe(201);
    expect(sendConsentEmailMock).toHaveBeenCalledTimes(1);
  });

  it("deliver: 'none' creates the link and returns it, but sends NO email — even when the lead has one", async () => {
    const { db, writes } = fakeDb([]);
    scopedClientMock.mockResolvedValue(db);

    const { POST } = await import("./route");
    const res = await POST(post("send", { deliver: "none" }), params());
    const body = await res.json();

    expect(res.status).toBe(201);
    expect(body.data.sent_via).toBe("link");
    expect(body.data.status).toBe("sent");
    expect(body.data.link).toMatch(/^https:\/\/crm\.test\/consent\/.+/);
    expect(sendConsentEmailMock).not.toHaveBeenCalled();
    // the record really was created (the link is only useful if it exists)
    expect(writes).toHaveBeenCalledWith(expect.objectContaining({ status: "sent", sent_via: "link" }));
  });

  it("with no email on file it is a link-only send either way (unchanged behaviour)", async () => {
    currentLead = { ...LEAD, email: null };
    const { db } = fakeDb([]);
    scopedClientMock.mockResolvedValue(db);

    const { POST } = await import("./route");
    const body = await (await POST(post("send"), params())).json();

    expect(body.data.sent_via).toBe("link");
    expect(sendConsentEmailMock).not.toHaveBeenCalled();
  });

  it("rejects an unknown deliver value with 400 INVALID_DELIVER and creates nothing", async () => {
    const { db, writes } = fakeDb([]);
    scopedClientMock.mockResolvedValue(db);

    const { POST } = await import("./route");
    const res = await POST(post("send", { deliver: "sms" }), params());
    const body = await res.json();

    expect(res.status).toBe(400);
    expect(body.error.code).toBe("INVALID_DELIVER");
    expect(writes).not.toHaveBeenCalled();
    expect(sendConsentEmailMock).not.toHaveBeenCalled();
  });

  it("deliver: 'none' on an already-signed lead is still refused with 409 ALREADY_SIGNED", async () => {
    const { db, writes } = fakeDb([row({ id: "signed-1", status: "signed" })]);
    scopedClientMock.mockResolvedValue(db);

    const { POST } = await import("./route");
    const res = await POST(post("send", { deliver: "none" }), params());
    const body = await res.json();

    expect(res.status).toBe(409);
    expect(body.error.code).toBe("ALREADY_SIGNED");
    expect(writes).not.toHaveBeenCalled();
  });
});
