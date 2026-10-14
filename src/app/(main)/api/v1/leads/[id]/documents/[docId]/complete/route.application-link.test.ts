// Linking an uploaded document to a university application: the route must prove the link first, write
// nothing when it is rejected, and only add the two link columns when there is a valid link.
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { NextRequest } from "next/server";
import type { AuthContext } from "@/lib/api/auth";

const authenticateRequestMock = vi.fn();
const getFeatureAccessMock = vi.fn();
const scopedClientMock = vi.fn();
const assertLeadVisibleMock = vi.fn();
const existsMock = vi.fn();
const resolveLinkMock = vi.fn();

vi.mock("@/lib/api/auth", () => ({ authenticateRequest: authenticateRequestMock }));
vi.mock("@/industries/_loader", () => ({ getFeatureAccess: getFeatureAccessMock }));
vi.mock("@/lib/supabase/scoped", () => ({ scopedClient: scopedClientMock }));
vi.mock("@/lib/documents/access", () => ({ assertLeadVisible: assertLeadVisibleMock }));
vi.mock("@/lib/documents/storage/r2-provider", () => ({ getDocumentStorageProvider: () => ({ exists: existsMock }) }));
vi.mock("@/lib/api/audit", () => ({ createAuditLog: vi.fn(async () => undefined), emitEvent: vi.fn(async () => null) }));
vi.mock("@/lib/ai/flag", () => ({ isIngestionEnabledForTenant: vi.fn(async () => false) }));
vi.mock("@/lib/inngest/client", () => ({ inngest: { send: vi.fn(async () => undefined) } }));
vi.mock("@/lib/documents/application-link", () => ({ resolveApplicationLink: resolveLinkMock }));

const AUTH = { userId: "user-1", tenantId: "tenant-1", industryId: "education_consultancy" } as unknown as AuthContext;
const APP = "22222222-2222-4222-8222-222222222222";
const NOTE = "33333333-3333-4333-8333-333333333333";

const fakeReq = (body: unknown) => ({ json: async () => body }) as unknown as NextRequest;
const params = () => ({ params: Promise.resolve({ id: "lead-1", docId: "doc-1" }) });
const body = (extra: Record<string, unknown> = {}) => ({
  version_id: "44444444-4444-4444-8444-444444444444",
  document_type: "conditional_offer",
  name: "Arden conditional offer",
  original_filename: "offer.pdf",
  mime_type: "application/pdf",
  file_size: 1024,
  checksum: "a".repeat(64),
  ...extra,
});

function fakeDb() {
  const inserted: Record<string, unknown>[] = [];
  const existing = { eq: vi.fn(() => existing), is: vi.fn(() => existing), maybeSingle: vi.fn(async () => ({ data: null })) };
  const doc = {
    select: vi.fn(() => existing),
    insert: vi.fn((row: Record<string, unknown>) => {
      inserted.push(row);
      return { select: () => ({ single: async () => ({ data: { id: "doc-1", ...row }, error: null }) }) };
    }),
    update: vi.fn(() => ({ eq: () => ({ select: () => ({ single: async () => ({ data: { id: "doc-1" }, error: null }) }) }) })),
  };
  const db = {
    from: vi.fn((t: string) => {
      if (t === "applicant_documents") return doc;
      if (t === "tenant_document_settings") return { select: () => ({ maybeSingle: async () => ({ data: null }) }) };
      return { insert: async () => ({ error: null }) };
    }),
  };
  return { db, inserted };
}

beforeEach(() => {
  for (const m of [authenticateRequestMock, getFeatureAccessMock, scopedClientMock, assertLeadVisibleMock, existsMock, resolveLinkMock]) m.mockReset();
  authenticateRequestMock.mockResolvedValue(AUTH);
  getFeatureAccessMock.mockReturnValue(true);
  assertLeadVisibleMock.mockResolvedValue({ id: "lead-1" });
  existsMock.mockResolvedValue(true);
});

describe("complete route — application link", () => {
  it("saves application_id and application_note_id when the link is proven", async () => {
    const { db, inserted } = fakeDb();
    scopedClientMock.mockResolvedValue(db);
    resolveLinkMock.mockResolvedValue({ ok: true, applicationId: APP, noteId: NOTE });
    const { POST } = await import("./route");
    const res = await POST(fakeReq(body({ application_id: APP, application_note_id: NOTE })), params());
    expect(res.status).toBe(201);
    expect(resolveLinkMock).toHaveBeenCalledWith(AUTH, db, "lead-1", APP, NOTE);
    expect(inserted[0]).toMatchObject({ document_type: "conditional_offer", application_id: APP, application_note_id: NOTE });
  });

  it("an ordinary upload does not send the link columns at all", async () => {
    const { db, inserted } = fakeDb();
    scopedClientMock.mockResolvedValue(db);
    resolveLinkMock.mockResolvedValue({ ok: true, applicationId: null, noteId: null });
    const { POST } = await import("./route");
    const res = await POST(fakeReq(body({ document_type: "passport" })), params());
    expect(res.status).toBe(201);
    expect("application_id" in inserted[0]).toBe(false);
    expect("application_note_id" in inserted[0]).toBe(false);
  });

  it.each([
    ["VALIDATION", 422],
    ["NOT_FOUND", 404],
    ["FORBIDDEN", 403],
    ["DB_ERROR", 500],
  ] as const)("a rejected link (%s) returns %i and writes NOTHING — not even the storage check", async (code, status) => {
    const { db, inserted } = fakeDb();
    scopedClientMock.mockResolvedValue(db);
    resolveLinkMock.mockResolvedValue({ ok: false, code, field: "application_id", message: "nope" });
    const { POST } = await import("./route");
    const res = await POST(fakeReq(body({ application_id: APP })), params());
    expect(res.status).toBe(status);
    expect(inserted).toHaveLength(0);
    expect(existsMock).not.toHaveBeenCalled();
  });

  it("accepts the two new offer document types", async () => {
    const { db } = fakeDb();
    scopedClientMock.mockResolvedValue(db);
    resolveLinkMock.mockResolvedValue({ ok: true, applicationId: null, noteId: null });
    const { POST } = await import("./route");
    for (const type of ["conditional_offer", "unconditional_offer"]) {
      expect((await POST(fakeReq(body({ document_type: type })), params())).status).toBe(201);
    }
  });
});
