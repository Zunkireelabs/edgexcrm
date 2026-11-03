import { describe, it, expect, vi, beforeEach } from "vitest";
import type { NextRequest } from "next/server";

// GET /api/v1/leads/[id]/applications feeds the lead's Activity. Client request (2026-11-03): the files attached
// to an application must show there. So each note carries its `documents`, and each application carries
// `application_documents` (files added straight to it, no note). Everything is faked — no DB.

const state = vi.hoisted(() => ({
  apps: [] as Record<string, unknown>[],
  notes: [] as Record<string, unknown>[],
  docs: [] as Record<string, unknown>[],
  docsError: null as unknown,
  docsFilters: [] as Array<[string, unknown[]]>,
}));

vi.mock("@/lib/api/auth", () => ({
  authenticateRequest: vi.fn(async () => ({
    userId: "user-1", tenantId: "tenant-1", role: "admin", industryId: "education_consultancy",
    positionSlug: null, branchId: null, permissions: { baseTier: "admin", leadScope: "all" },
  })),
  requireLeadBranchAccess: () => true,
  getClientIp: () => "127.0.0.1",
}));
vi.mock("@/industries/_loader", () => ({ getFeatureAccess: () => true }));
vi.mock("@/lib/api/permissions", () => ({ shouldRestrictToSelf: () => false, canManageApplications: () => true }));
vi.mock("@/lib/api/applications", () => ({ canCreateOrReorderApplications: () => true }));
vi.mock("@/lib/leads/branch-membership", () => ({ getLeadMembership: async () => [] }));
vi.mock("@/lib/leads/collaborators", () => ({ isLeadCollaborator: async () => false }));
vi.mock("@/lib/leads/profile-completeness", () => ({ checkLeadProfileCompleteness: async () => ({ complete: true, missing: [] }) }));
vi.mock("@/lib/leads/applications-readiness", () => ({ checkProcessingFeeEntered: async () => true }));
vi.mock("@/lib/leads/touch-updated-at", () => ({ touchLeadUpdatedAt: async () => {} }));
vi.mock("@/lib/api/audit", () => ({ createAuditLog: async () => {}, emitEvent: async () => {} }));
vi.mock("@/lib/logger", () => ({ createRequestLogger: () => ({ info() {}, error() {}, warn() {} }) }));
vi.mock("@/lib/applications/pipeline-resolution", () => ({ alignStageToCountryPipeline: vi.fn() }));

function table(name: string) {
  const b: Record<string, unknown> = {};
  for (const m of ["select", "eq", "order", "limit"]) b[m] = () => b;
  b.is = (col: string, val: unknown) => {
    if (name === "applicant_documents") state.docsFilters.push([`is:${col}`, [val]]);
    return b;
  };
  b.in = (col: string, vals: unknown[]) => {
    if (name === "applicant_documents") state.docsFilters.push([`in:${col}`, vals]);
    return b;
  };
  b.then = (resolve: (v: unknown) => unknown) => {
    if (name === "applications") return resolve({ data: state.apps, error: null });
    if (name === "application_notes") return resolve({ data: state.notes, error: null });
    if (name === "applicant_documents") return resolve({ data: state.docsError ? null : state.docs, error: state.docsError });
    return resolve({ data: [], error: null });
  };
  b.single = async () => ({ data: { id: "lead-1", assigned_to: "user-1", branch_id: null }, error: null });
  b.maybeSingle = b.single;
  return b;
}
const client = () => ({ from: (t: string) => table(t) });
vi.mock("@/lib/supabase/server", () => ({ createServiceClient: async () => client() }));
vi.mock("@/lib/supabase/scoped", () => ({ scopedClient: async () => client() }));

import { GET } from "./route";
const call = () => GET({} as NextRequest, { params: Promise.resolve({ id: "lead-1" }) });

const doc = (id: string, over: Record<string, unknown> = {}) => ({
  id, name: id, document_type: "offer_letter", original_filename: `${id}.pdf`,
  application_id: "app-1", application_note_id: null, uploaded_by: "user-1", created_at: "2026-11-03T10:00:00Z", ...over,
});

beforeEach(() => {
  state.apps = [
    { id: "app-1", university_name: "University of East London", program_name: "BA Hons Hospitality" },
    { id: "app-2", university_name: "Other Uni", program_name: "MSc Data" },
  ];
  state.notes = [
    { id: "note-1", application_id: "app-1", content: "Offer received", user_id: "user-1", created_at: "2026-11-03T10:00:00Z" },
    { id: "note-2", application_id: "app-2", content: "Hello", user_id: "user-1", created_at: "2026-11-03T11:00:00Z" },
  ];
  state.docs = [];
  state.docsError = null;
  state.docsFilters = [];
});

describe("GET /api/v1/leads/[id]/applications — files for the Activity feed", () => {
  it("puts a note's files on that note, and files with no note on the application", async () => {
    state.docs = [doc("on-note", { application_note_id: "note-1" }), doc("direct", { application_id: "app-1" }), doc("other-app", { application_id: "app-2" })];
    const { data } = await (await call()).json();
    const app1 = data.find((a: { id: string }) => a.id === "app-1");
    const app2 = data.find((a: { id: string }) => a.id === "app-2");
    expect(app1.application_notes[0].documents.map((d: { id: string }) => d.id)).toEqual(["on-note"]);
    expect(app1.application_documents.map((d: { id: string }) => d.id)).toEqual(["direct"]);
    // nothing leaks across applications
    expect(app2.application_notes[0].documents).toEqual([]);
    expect(app2.application_documents.map((d: { id: string }) => d.id)).toEqual(["other-app"]);
  });

  it("still returns the course name (program_name) the feed needs", async () => {
    const { data } = await (await call()).json();
    expect(data[0].program_name).toBe("BA Hons Hospitality");
  });

  it("only asks for this lead's applications' files that are not deleted", async () => {
    await call();
    expect(state.docsFilters).toContainEqual(["in:application_id", ["app-1", "app-2"]]);
    expect(state.docsFilters).toContainEqual(["is:deleted_at", [null]]);
  });

  it("if the files lookup fails, notes and applications still load (just without files)", async () => {
    state.docsError = { message: "boom" };
    const res = await call();
    expect(res.status).toBe(200);
    const { data } = await res.json();
    expect(data).toHaveLength(2);
    expect(data[0].application_notes[0].content).toBe("Offer received");
    expect(data[0].application_notes[0].documents).toBeUndefined();
  });
});
