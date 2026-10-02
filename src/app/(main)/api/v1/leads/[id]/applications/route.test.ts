import { describe, it, expect, vi, beforeEach } from "vitest";
import type { NextRequest } from "next/server";

// Wiring test for the application create route: the stage/pipeline decision comes from the shared
// alignStageToCountryPipeline() (mocked here — its own cases live in pipeline-resolution.test.ts), and
// the route must save exactly what it returns: stage_id, status (stage slug) and pipeline_id. A
// client-supplied pipeline_id must never be stored.

const { alignMock, inserted } = vi.hoisted(() => ({
  alignMock: vi.fn(),
  inserted: { current: null as Record<string, unknown> | null },
}));

vi.mock("@/lib/api/auth", () => ({
  authenticateRequest: vi.fn(async () => ({
    userId: "user-1",
    tenantId: "tenant-1",
    role: "admin",
    industryId: "education_consultancy",
    positionSlug: null,
    branchId: null,
    permissions: { baseTier: "admin", leadScope: "all", canManageApplications: true },
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
vi.mock("@/lib/leads/touch-updated-at", () => ({ touchLeadUpdatedAt: async () => {} }));
vi.mock("@/lib/api/audit", () => ({ createAuditLog: async () => {}, emitEvent: async () => {} }));
vi.mock("@/lib/logger", () => ({ createRequestLogger: () => ({ info() {}, error() {}, warn() {} }) }));
vi.mock("@/lib/applications/pipeline-resolution", () => ({ alignStageToCountryPipeline: alignMock }));

// Chainable fake: every filter returns the builder, awaiting it resolves, terminals resolve per table.
function fakeClient() {
  return {
    from(table: string) {
      const b: Record<string, unknown> = {};
      for (const m of ["select", "eq", "is", "in", "order", "limit", "update", "delete"]) b[m] = () => b;
      b.insert = (row: Record<string, unknown>) => {
        if (table === "applications") inserted.current = row;
        return b;
      };
      const terminal = async () => {
        if (table === "leads") return { data: { id: "lead-1", assigned_to: "user-1", branch_id: null, lead_type: "prospect" }, error: null };
        if (table === "application_stages") return { data: { id: "stage-sent", slug: "sent" }, error: null };
        if (table === "applications") return { data: inserted.current ? { id: "app-new", ...inserted.current } : null, error: null };
        return { data: null, error: null };
      };
      b.maybeSingle = terminal;
      b.single = terminal;
      b.then = (resolve: (v: unknown) => unknown) => resolve({ data: null, error: null });
      return b;
    },
  };
}
vi.mock("@/lib/supabase/server", () => ({ createServiceClient: async () => fakeClient() }));
vi.mock("@/lib/supabase/scoped", () => ({ scopedClient: async () => fakeClient() }));

import { POST } from "./route";

const callPost = (req: NextRequest) => POST(req, { params: Promise.resolve({ id: "lead-1" }) });

function post(body: Record<string, unknown>) {
  return new Request("http://localhost/api", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ university_name: "Uni", program_name: "Prog", ...body }),
  }) as unknown as NextRequest;
}

beforeEach(() => {
  inserted.current = null;
  alignMock.mockReset();
});

describe("POST /api/v1/leads/[id]/applications — stage + pipeline wiring", () => {
  it("saves the stage, status and pipeline the shared helper resolved", async () => {
    alignMock.mockResolvedValue({ stageId: "entry-uk", stageSlug: "uk-shortlisted", pipelineId: "pipe-uk" });
    const res = await callPost(post({ countries: ["UK"], stage_id: "stage-from-another-pipeline" }));
    expect(res.status).toBe(201);
    expect(alignMock).toHaveBeenCalledWith(
      expect.anything(),
      expect.anything(),
      expect.objectContaining({ tenantId: "tenant-1", countries: ["UK"], stageId: "stage-from-another-pipeline" }),
    );
    expect(inserted.current).toMatchObject({ stage_id: "entry-uk", status: "uk-shortlisted", pipeline_id: "pipe-uk" });
  });

  it("never stores a client-supplied pipeline_id", async () => {
    alignMock.mockResolvedValue({ stageId: "entry-uk", stageSlug: "uk-shortlisted", pipelineId: "pipe-uk" });
    await callPost(post({ countries: ["UK"], pipeline_id: "pipe-evil" }));
    expect(inserted.current?.pipeline_id).toBe("pipe-uk");
  });

  it("leaves pipeline_id out when no pipeline resolves (stage unchanged)", async () => {
    alignMock.mockResolvedValue({ stageId: "stage-sent", stageSlug: "sent", pipelineId: null });
    const res = await callPost(post({}));
    expect(res.status).toBe(201);
    expect(inserted.current).toMatchObject({ stage_id: "stage-sent", status: "sent" });
    expect(inserted.current).not.toHaveProperty("pipeline_id");
  });
});
