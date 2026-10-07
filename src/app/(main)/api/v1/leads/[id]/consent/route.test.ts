import { describe, it, expect, vi, beforeEach } from "vitest";
import type { NextRequest } from "next/server";
import type { AuthContext } from "@/lib/api/auth";

// No database: every Supabase client is a hand-rolled fake. These tests pin the rule behind a
// production bug — a lead whose consent is signed must never be reported (or re-created) as unsigned.

const authenticateRequestMock = vi.fn();
const scopedClientMock = vi.fn();
const sendConsentEmailMock = vi.fn();
// The profile-readiness rule itself is unit-tested in src/lib/consent/readiness.test.ts; here it is a
// switch so these tests can pin what the ROUTE does with a ready / not-ready profile.
const loadConsentReadinessMock = vi.fn();
const READY = { ready: true, missing: [], groups: [] };
const NOT_READY = {
  ready: false,
  missing: ["Field of Study", "Degree Level"],
  groups: [{ section: "Study Interest", fields: ["Field of Study", "Degree Level"] }],
};

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
vi.mock("@/lib/consent/readiness", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/consent/readiness")>()),
  loadConsentReadiness: loadConsentReadinessMock,
}));

const LEAD = { id: "lead-1", assigned_to: "user-1", branch_id: null, email: "s@example.com", first_name: "S", last_name: "T", phone: "1", city: "K", country: "NP" };
let currentLead: Record<string, unknown> = LEAD;

function authAs(over: Partial<{ role: string; industryId: string }> = {}): AuthContext {
  return { userId: "user-1", tenantId: "tenant-1", industryId: "education_consultancy", role: "admin", permissions: {}, ...over } as unknown as AuthContext;
}

const getUserByIdMock = vi.fn();
function serviceClient() {
  const t: Record<string, unknown> = {};
  t.select = vi.fn(() => t);
  t.eq = vi.fn(() => t);
  t.is = vi.fn(() => t);
  t.single = vi.fn(async () => ({ data: currentLead }));
  return { from: vi.fn(() => t), auth: { admin: { getUserById: getUserByIdMock } } };
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
function fakeDb(
  records: ReturnType<typeof row>[],
  opts: { insertError?: { code?: string; message: string }; templateBody?: string } = {},
) {
  const writes = vi.fn();
  const template = {
    select: vi.fn(() => template),
    maybeSingle: vi.fn(async () => ({ data: { is_active: true, id: "tpl", body: opts.templateBody ?? "b", version: 1, link_expiry_days: 7, title: "t" } })),
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
    t.single = vi.fn(async () =>
      opts.insertError ? { data: null, error: opts.insertError } : { data: inserted ? { id: "new-consent", ...inserted } : null, error: null },
    );
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
  loadConsentReadinessMock.mockReset();
  loadConsentReadinessMock.mockResolvedValue(READY);
  currentLead = LEAD;
  getUserByIdMock.mockReset();
  getUserByIdMock.mockResolvedValue({ data: { user: { email: "anish@admizz.org", user_metadata: { full_name: "Anish Balami" } } } });
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

// Migration 254: at most one active unsigned consent per lead. Two sends racing each other make the
// loser's insert fail with a unique violation (Postgres 23505) — that must read as "someone just did
// this" (409), not as a server error, and must not go on to email anybody.
describe("POST /api/v1/leads/[id]/consent — concurrent send (migration 254 unique index)", () => {
  const UNIQUE = { code: "23505", message: 'duplicate key value violates unique constraint "uq_lead_consents_one_active_unsigned"' };

  it.each(["send", "send_in_person"])("'%s': a unique violation on insert becomes 409 CONSENT_IN_PROGRESS, not a 500", async (action) => {
    const { db } = fakeDb([], { insertError: UNIQUE });
    scopedClientMock.mockResolvedValue(db);

    const { POST } = await import("./route");
    const res = await POST(post(action), params());
    const body = await res.json();

    expect(res.status).toBe(409);
    expect(body.error.code).toBe("CONSENT_IN_PROGRESS");
    expect(sendConsentEmailMock).not.toHaveBeenCalled();
  });

  it.each(["send", "send_in_person"])("'%s': any other insert failure is still a 500 DB_ERROR", async (action) => {
    const { db } = fakeDb([], { insertError: { code: "XX000", message: "boom" } });
    scopedClientMock.mockResolvedValue(db);

    const { POST } = await import("./route");
    const res = await POST(post(action), params());
    const body = await res.json();

    expect(res.status).toBe(500);
    expect(body.error.code).toBe("DB_ERROR");
  });
});

// Education: consent waits for a complete student profile (the document is filled from it).
describe("consent — student profile readiness (education)", () => {
  it("GET returns the readiness so the card can show what is missing", async () => {
    loadConsentReadinessMock.mockResolvedValue(NOT_READY);
    const { db } = fakeDb([]);
    scopedClientMock.mockResolvedValue(db);

    const { GET } = await import("./route");
    const body = await (await GET({} as NextRequest, params())).json();

    expect(body.data.readiness).toEqual(NOT_READY);
  });

  it("GET skips the check for other industries (readiness is null)", async () => {
    authenticateRequestMock.mockResolvedValue(authAs({ industryId: "it_agency" }));
    const { db } = fakeDb([]);
    scopedClientMock.mockResolvedValue(db);

    const { GET } = await import("./route");
    const body = await (await GET({} as NextRequest, params())).json();

    expect(body.data.readiness).toBeNull();
    expect(loadConsentReadinessMock).not.toHaveBeenCalled();
  });

  it.each(["send", "send_in_person", "record_manual"])(
    "'%s' with an incomplete profile is refused with 422 PROFILE_INCOMPLETE_FOR_CONSENT and creates nothing",
    async (action) => {
      loadConsentReadinessMock.mockResolvedValue(NOT_READY);
      const { db, writes } = fakeDb([]);
      scopedClientMock.mockResolvedValue(db);

      const { POST } = await import("./route");
      const res = await POST(post(action), params());
      const body = await res.json();

      expect(res.status).toBe(422);
      expect(body.error.code).toBe("PROFILE_INCOMPLETE_FOR_CONSENT");
      expect(body.error.message).toContain("Field of Study, Degree Level");
      expect(writes).not.toHaveBeenCalled();
      expect(sendConsentEmailMock).not.toHaveBeenCalled();
    },
  );

  it("a non-admin cannot override the profile check (403), whatever the profile state", async () => {
    authenticateRequestMock.mockResolvedValue(authAs({ role: "viewer" }));
    loadConsentReadinessMock.mockResolvedValue(NOT_READY);
    const { db, writes } = fakeDb([]);
    scopedClientMock.mockResolvedValue(db);

    const { POST } = await import("./route");
    const res = await POST(post("send", { override_profile_check: true }), params());

    expect(res.status).toBe(403);
    expect(writes).not.toHaveBeenCalled();
  });

  it("an admin override sends anyway and writes a consent.profile_check_overridden audit entry", async () => {
    loadConsentReadinessMock.mockResolvedValue(NOT_READY);
    const { db } = fakeDb([]);
    scopedClientMock.mockResolvedValue(db);
    const { createAuditLog } = await import("@/lib/api/audit");
    vi.mocked(createAuditLog).mockClear();

    const { POST } = await import("./route");
    const res = await POST(post("send", { override_profile_check: true }), params());

    expect(res.status).toBe(201);
    expect(sendConsentEmailMock).toHaveBeenCalledTimes(1);
    expect(createAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({ action: "consent.profile_check_overridden", entityId: "lead-1" }),
    );
  });

  it("an already-signed lead still gets 409 ALREADY_SIGNED, not the profile error", async () => {
    loadConsentReadinessMock.mockResolvedValue(NOT_READY);
    const { db } = fakeDb([row({ id: "signed-1", status: "signed" })]);
    scopedClientMock.mockResolvedValue(db);

    const { POST } = await import("./route");
    const res = await POST(post("send"), params());
    const body = await res.json();

    expect(res.status).toBe(409);
    expect(body.error.code).toBe("ALREADY_SIGNED");
  });

  it("other industries are never blocked by the profile check", async () => {
    authenticateRequestMock.mockResolvedValue(authAs({ industryId: "it_agency" }));
    loadConsentReadinessMock.mockResolvedValue(NOT_READY);
    const { db } = fakeDb([]);
    scopedClientMock.mockResolvedValue(db);

    const { POST } = await import("./route");
    const res = await POST(post("send"), params());

    expect(res.status).toBe(201);
    expect(loadConsentReadinessMock).not.toHaveBeenCalled();
  });
});

// Review point 4: the readiness check must reuse the template + lead the route already loaded.
describe("consent — readiness reuses what the route already read", () => {
  it("GET passes the loaded template and lead row (no second read)", async () => {
    const { db } = fakeDb([]);
    scopedClientMock.mockResolvedValue(db);

    const { GET } = await import("./route");
    await GET({} as NextRequest, params());

    const preloaded = loadConsentReadinessMock.mock.calls[0][3];
    expect(preloaded.template).toEqual(expect.objectContaining({ is_active: true, body: "b" }));
    expect(preloaded.profile).toEqual(expect.objectContaining({ id: "lead-1" }));
  });

  it("POST passes the loaded lead row (no second read)", async () => {
    const { db } = fakeDb([]);
    scopedClientMock.mockResolvedValue(db);

    const { POST } = await import("./route");
    await POST(post("send"), params());

    expect(loadConsentReadinessMock.mock.calls[0][3].profile).toEqual(expect.objectContaining({ id: "lead-1" }));
  });
});

describe("consent — counselor name ({{assign_name}} / {{counselor_name}})", () => {
  const TEMPLATE = "Counselor: {{assign_name}} / {{counselor_name}}";

  it.each(["send", "send_in_person"])("'%s' fills the assigned counselor's name into the document", async (action) => {
    const { db, writes } = fakeDb([], { templateBody: TEMPLATE });
    scopedClientMock.mockResolvedValue(db);

    const { POST } = await import("./route");
    const res = await POST(post(action), params());

    expect(res.status).toBe(201);
    expect(getUserByIdMock).toHaveBeenCalledWith("user-1");
    const inserted = writes.mock.calls.map((c) => c[0]).find((w) => w && "body_snapshot" in w);
    expect(inserted.body_snapshot).toBe("Counselor: Anish Balami / Anish Balami");
  });

  it("falls back to the counselor's email when they have no name set", async () => {
    getUserByIdMock.mockResolvedValue({ data: { user: { email: "anish@admizz.org", user_metadata: {} } } });
    const { db, writes } = fakeDb([], { templateBody: TEMPLATE });
    scopedClientMock.mockResolvedValue(db);

    const { POST } = await import("./route");
    await POST(post("send"), params());

    const inserted = writes.mock.calls.map((c) => c[0]).find((w) => w && "body_snapshot" in w);
    expect(inserted.body_snapshot).toBe("Counselor: anish@admizz.org / anish@admizz.org");
  });

  it.each(["send", "send_in_person"])("'%s' with no assigned counselor is refused with 422 and replaces nothing", async (action) => {
    currentLead = { ...LEAD, assigned_to: null };
    const { db, writes } = fakeDb([], { templateBody: TEMPLATE });
    scopedClientMock.mockResolvedValue(db);

    const { POST } = await import("./route");
    const res = await POST(post(action), params());
    const body = await res.json();

    expect(res.status).toBe(422);
    expect(body.error.code).toBe("PROFILE_INCOMPLETE_FOR_CONSENT");
    expect(body.error.message).toContain("Assigned Counselor");
    expect(writes).not.toHaveBeenCalled(); // the previous unsigned link is untouched
  });

  it("a counselor lookup failure is refused the same way, never sent as a blank line", async () => {
    getUserByIdMock.mockRejectedValue(new Error("auth down"));
    const { db, writes } = fakeDb([], { templateBody: TEMPLATE });
    scopedClientMock.mockResolvedValue(db);

    const { POST } = await import("./route");
    const res = await POST(post("send"), params());

    expect(res.status).toBe(422);
    expect(writes).not.toHaveBeenCalled();
  });

  it("an admin override sends anyway", async () => {
    currentLead = { ...LEAD, assigned_to: null };
    const { db } = fakeDb([], { templateBody: TEMPLATE });
    scopedClientMock.mockResolvedValue(db);

    const { POST } = await import("./route");
    const res = await POST(post("send", { override_profile_check: true }), params());

    expect(res.status).toBe(201);
  });

  it("does not look the counselor up when the template doesn't use the placeholder", async () => {
    const { db } = fakeDb([], { templateBody: "Hello {{student_name}}" });
    scopedClientMock.mockResolvedValue(db);

    const { POST } = await import("./route");
    await POST(post("send"), params());

    expect(getUserByIdMock).not.toHaveBeenCalled();
  });
});
