import { describe, it, expect, vi, beforeEach } from "vitest";
import type { NextRequest } from "next/server";
import type { AuthContext } from "@/lib/api/auth";

const authenticateRequestMock = vi.fn();
const getFeatureAccessMock = vi.fn();
const scopedClientMock = vi.fn();
const canViewLeadMock = vi.fn();
const canEnrollStudentsMock = vi.fn();
const createAuditLogMock = vi.fn();
const emitEventMock = vi.fn();

vi.mock("@/lib/api/auth", async () => {
  const actual = await vi.importActual<typeof import("@/lib/api/auth")>("@/lib/api/auth");
  return { ...actual, authenticateRequest: authenticateRequestMock };
});
vi.mock("@/industries/_loader", () => ({ getFeatureAccess: getFeatureAccessMock }));
vi.mock("@/lib/supabase/scoped", () => ({ scopedClient: scopedClientMock }));
vi.mock("@/lib/ai/tools/universal/lib/lead-visibility", () => ({ canViewLead: canViewLeadMock }));
vi.mock("@/lib/api/class-attendance", () => ({ canEnrollStudents: canEnrollStudentsMock }));
vi.mock("@/lib/api/audit", () => ({ createAuditLog: createAuditLogMock, emitEvent: emitEventMock }));

const LEAD = { id: "lead-1", assigned_to: "owner-user", branch_id: null, pipeline_id: "pipe-1", list_id: null };

function authAs(userId = "user-1"): AuthContext {
  return { userId, tenantId: "tenant-1", industryId: "education_consultancy", role: "counselor", permissions: {} } as unknown as AuthContext;
}

function fakeReq(body?: unknown): NextRequest {
  return { json: async () => body } as unknown as NextRequest;
}

function params() {
  return { params: Promise.resolve({ id: "lead-1" }) };
}

function makeLeadsTable(lead: Record<string, unknown> | null) {
  const table: Record<string, unknown> = {};
  table.select = vi.fn(() => table);
  table.eq = vi.fn(() => table);
  table.is = vi.fn(() => table);
  table.maybeSingle = vi.fn(async () => ({ data: lead }));
  return table;
}

function makeEnrollmentsTable(opts: {
  enrollments?: Record<string, unknown>[];
  enrollmentsError?: unknown;
  insertResult?: { data?: Record<string, unknown> | null; error?: unknown };
}) {
  const table: Record<string, unknown> = {};
  table.select = vi.fn(() => table);
  table.eq = vi.fn(() => table);
  table.is = vi.fn(() => table);
  table.order = vi.fn(async () => ({ data: opts.enrollments ?? [], error: opts.enrollmentsError ?? null }));
  table.insert = vi.fn(() => table);
  table.single = vi.fn(async () => ({ data: opts.insertResult?.data ?? null, error: opts.insertResult?.error ?? null }));
  return table;
}

function makeClassesTable(classRow: Record<string, unknown> | null) {
  const table: Record<string, unknown> = {};
  table.select = vi.fn(() => table);
  table.eq = vi.fn(() => table);
  table.maybeSingle = vi.fn(async () => ({ data: classRow }));
  return table;
}

function fakeDb(opts: {
  lead?: Record<string, unknown> | null;
  enrollments?: Record<string, unknown>[];
  enrollmentsError?: unknown;
  classRow?: Record<string, unknown> | null;
  insertResult?: { data?: Record<string, unknown> | null; error?: unknown };
}) {
  const leadsTable = makeLeadsTable(opts.lead === undefined ? LEAD : opts.lead);
  const enrollmentsTable = makeEnrollmentsTable(opts);
  const classesTable = makeClassesTable(opts.classRow ?? null);
  return {
    from: vi.fn((table: string) => {
      if (table === "leads") return leadsTable;
      if (table === "class_enrollments") return enrollmentsTable;
      if (table === "classes") return classesTable;
      throw new Error(`unexpected table: ${table}`);
    }),
  };
}

describe("GET /api/v1/leads/[id]/classes", () => {
  beforeEach(() => {
    authenticateRequestMock.mockReset();
    getFeatureAccessMock.mockReset();
    scopedClientMock.mockReset();
    canViewLeadMock.mockReset();
    authenticateRequestMock.mockResolvedValue(authAs());
    getFeatureAccessMock.mockReturnValue(true);
  });

  it("401 when unauthenticated", async () => {
    authenticateRequestMock.mockResolvedValue(null);
    const { GET } = await import("./route");
    const res = await GET({} as NextRequest, params());
    expect(res.status).toBe(401);
  });

  it("403 when the tenant's industry doesn't have the Classes feature", async () => {
    getFeatureAccessMock.mockReturnValue(false);
    const { GET } = await import("./route");
    const res = await GET({} as NextRequest, params());
    expect(res.status).toBe(403);
  });

  it("404 when the lead doesn't exist in this tenant — never calls canViewLead", async () => {
    scopedClientMock.mockResolvedValue(fakeDb({ lead: null }));
    const { GET } = await import("./route");
    const res = await GET({} as NextRequest, params());
    expect(res.status).toBe(404);
    expect(canViewLeadMock).not.toHaveBeenCalled();
  });

  it("REGRESSION (the actual prod bug): 404 when canViewLead says no — collaborator-blind own-scope logic used to allow this through incorrectly worded checks; now the single source of truth decides", async () => {
    scopedClientMock.mockResolvedValue(fakeDb({}));
    canViewLeadMock.mockResolvedValue(false);
    const { GET } = await import("./route");
    const res = await GET({} as NextRequest, params());
    expect(res.status).toBe(404);
  });

  it("200 with the lead's enrollments when canViewLead says yes — this is the collaborator case that was previously broken", async () => {
    const enrollment = { id: "enr-1", lead_id: "lead-1", class_id: "class-1", classes: { id: "class-1", name: "IELTS Physical", default_fee: 4000 } };
    scopedClientMock.mockResolvedValue(fakeDb({ enrollments: [enrollment] }));
    canViewLeadMock.mockResolvedValue(true);
    const { GET } = await import("./route");
    const res = await GET({} as NextRequest, params());
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.data).toEqual([enrollment]);
  });

  it("passes the full lead row (id, assigned_to, branch_id, pipeline_id, list_id) to canViewLead", async () => {
    scopedClientMock.mockResolvedValue(fakeDb({}));
    canViewLeadMock.mockResolvedValue(true);
    const { GET } = await import("./route");
    await GET({} as NextRequest, params());
    expect(canViewLeadMock).toHaveBeenCalledWith(expect.anything(), expect.anything(), LEAD);
  });

  it("500 when the enrollments query errors", async () => {
    scopedClientMock.mockResolvedValue(fakeDb({ enrollmentsError: { message: "db down" } }));
    canViewLeadMock.mockResolvedValue(true);
    const { GET } = await import("./route");
    const res = await GET({} as NextRequest, params());
    expect(res.status).toBe(500);
  });
});

describe("POST /api/v1/leads/[id]/classes", () => {
  beforeEach(() => {
    authenticateRequestMock.mockReset();
    getFeatureAccessMock.mockReset();
    scopedClientMock.mockReset();
    canViewLeadMock.mockReset();
    canEnrollStudentsMock.mockReset();
    createAuditLogMock.mockReset();
    emitEventMock.mockReset();
    authenticateRequestMock.mockResolvedValue(authAs());
    getFeatureAccessMock.mockReturnValue(true);
    canEnrollStudentsMock.mockResolvedValue(true);
    createAuditLogMock.mockResolvedValue(undefined);
    emitEventMock.mockResolvedValue(undefined);
  });

  it("401 when unauthenticated", async () => {
    authenticateRequestMock.mockResolvedValue(null);
    const { POST } = await import("./route");
    const res = await POST(fakeReq({ class_id: "class-1" }), params());
    expect(res.status).toBe(401);
  });

  it("403 when the caller can't enroll students — never touches the lead/class lookups", async () => {
    canEnrollStudentsMock.mockResolvedValue(false);
    scopedClientMock.mockResolvedValue(fakeDb({}));
    const { POST } = await import("./route");
    const res = await POST(fakeReq({ class_id: "class-1" }), params());
    expect(res.status).toBe(403);
    expect(canViewLeadMock).not.toHaveBeenCalled();
  });

  it("404 when the lead isn't visible to the caller (canViewLead false) — the exact prod bug for POST's own copy of the check", async () => {
    scopedClientMock.mockResolvedValue(fakeDb({}));
    canViewLeadMock.mockResolvedValue(false);
    const { POST } = await import("./route");
    const res = await POST(fakeReq({ class_id: "class-1" }), params());
    expect(res.status).toBe(404);
  });

  it("422 on missing class_id", async () => {
    scopedClientMock.mockResolvedValue(fakeDb({}));
    canViewLeadMock.mockResolvedValue(true);
    const { POST } = await import("./route");
    const res = await POST(fakeReq({}), params());
    expect(res.status).toBe(422);
  });

  it("404 when the class doesn't exist", async () => {
    scopedClientMock.mockResolvedValue(fakeDb({ classRow: null }));
    canViewLeadMock.mockResolvedValue(true);
    const { POST } = await import("./route");
    const res = await POST(fakeReq({ class_id: "missing-class" }), params());
    expect(res.status).toBe(404);
  });

  it("400 when the class is inactive", async () => {
    scopedClientMock.mockResolvedValue(fakeDb({ classRow: { id: "class-1", name: "IELTS", default_fee: null, is_active: false } }));
    canViewLeadMock.mockResolvedValue(true);
    const { POST } = await import("./route");
    const res = await POST(fakeReq({ class_id: "class-1" }), params());
    expect(res.status).toBe(400);
  });

  it("201 on success — a collaborator (not assignee) can now enroll a student, matching what canViewLead allows", async () => {
    const created = { id: "enr-new", lead_id: "lead-1", class_id: "class-1" };
    scopedClientMock.mockResolvedValue(
      fakeDb({
        classRow: { id: "class-1", name: "IELTS", default_fee: 4000, is_active: true },
        insertResult: { data: created },
      }),
    );
    canViewLeadMock.mockResolvedValue(true);
    const { POST } = await import("./route");
    const res = await POST(fakeReq({ class_id: "class-1" }), params());
    const body = await res.json();
    expect(res.status).toBe(201);
    expect(body.data).toEqual(created);
    expect(createAuditLogMock).toHaveBeenCalled();
    expect(emitEventMock).toHaveBeenCalled();
  });

  it("409 when the DB reports a duplicate enrollment (unique-constraint code 23505)", async () => {
    scopedClientMock.mockResolvedValue(
      fakeDb({
        classRow: { id: "class-1", name: "IELTS", default_fee: 4000, is_active: true },
        insertResult: { error: { code: "23505" } },
      }),
    );
    canViewLeadMock.mockResolvedValue(true);
    const { POST } = await import("./route");
    const res = await POST(fakeReq({ class_id: "class-1" }), params());
    expect(res.status).toBe(409);
  });
});
