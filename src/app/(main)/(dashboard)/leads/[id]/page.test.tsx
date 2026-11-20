import { describe, it, expect, vi, beforeEach } from "vitest";

// Route shell: education tenants get the new lead detail, every other industry keeps LeadDetailV2 with the props it always had.
// No database: every query and permission helper is a hand-rolled fake.

const tenant = vi.hoisted(() => ({ current: null as Record<string, unknown> | null }));

const lead = { id: "lead-1", assigned_to: null, list_id: null, branch_id: null, entity_id: null, tags: [] };
vi.mock("@/lib/supabase/queries", () => ({
  getCurrentUserTenant: vi.fn(async () => tenant.current),
  getLead: vi.fn(async () => lead),
  getLeadNotes: vi.fn(async () => []),
  getLeadChecklists: vi.fn(async () => []),
  getLeadActivity: vi.fn(async () => []),
  getLeadSubmissionHistory: vi.fn(async () => []),
  getPipelineStages: vi.fn(async () => []),
  getLeadListsByTenant: vi.fn(async () => []),
  getListPipeline: vi.fn(async () => null),
  getTeamMembers: vi.fn(async () => []),
}));
vi.mock("@/lib/supabase/server", () => ({
  createServiceClient: async () => ({
    from: () => ({ select: () => ({ eq: () => ({ eq: () => ({ eq: () => ({ is: () => ({ limit: () => ({ maybeSingle: async () => ({ data: null }) }) }) }), maybeSingle: async () => ({ data: null }), single: async () => ({ data: null }) }), single: async () => ({ data: null }), maybeSingle: async () => ({ data: null }) }) }) }),
  }),
}));
vi.mock("@/lib/api/permissions", () => ({
  canSeeNav: () => true,
  canAccessList: () => true,
  leadQueryScope: () => "all",
}));
vi.mock("@/lib/api/class-attendance", () => ({ canEnrollStudents: async () => true }));
vi.mock("@/lib/api/applications", () => ({ canCreateOrReorderApplications: () => true }));
vi.mock("@/components/dashboard/lead/lead-detail-v2", () => ({ LeadDetailV2: () => null }));
vi.mock("@/industries/education-consultancy/features/lead-detail/lead-detail-edu", () => ({ LeadDetailEdu: () => null }));

class Redirect extends Error {
  constructor(public to: string) { super(to); }
}
class NotFound extends Error {}
vi.mock("next/navigation", () => ({
  redirect: (to: string) => { throw new Redirect(to); },
  notFound: () => { throw new NotFound(); },
}));

import Page from "./page";
import { LeadDetailV2 } from "@/components/dashboard/lead/lead-detail-v2";
import { LeadDetailEdu } from "@/industries/education-consultancy/features/lead-detail/lead-detail-edu";

const mk = (industry: string) => ({
  tenant: { id: "t1", industry_id: industry, name: "T", logo_url: null },
  role: "admin",
  userId: "u1",
  positionId: null,
  positionName: null,
  positionSlug: null,
  branchId: null,
  permissions: { baseTier: "admin", leadScope: "all", canAssignLeads: true, canEditLeads: true, canManageApplications: true },
});
const params = Promise.resolve({ id: "lead-1" });

beforeEach(() => { tenant.current = mk("education_consultancy"); });

describe("/leads/[id] route shell", () => {
  it("redirects an anonymous visitor to /login", async () => {
    tenant.current = null;
    await expect(Page({ params })).rejects.toMatchObject({ to: "/login" });
  });

  it("renders LeadDetailEdu, keyed by the lead id, for education_consultancy", async () => {
    const el = (await Page({ params })) as { type: unknown; key: string; props: Record<string, unknown> };
    expect(el.type).toBe(LeadDetailEdu);
    expect(el.key).toBe("lead-1");
    expect(el.props.lead).toBe(lead);
    expect(el.props.userId).toBe("u1");
  });

  it.each(["it_agency", "travel_agency", "construction", "general", "real_estate"])("renders LeadDetailV2 for %s", async (industry) => {
    tenant.current = mk(industry);
    const el = (await Page({ params })) as { type: unknown; key: string | null; props: Record<string, unknown> };
    expect(el.type).toBe(LeadDetailV2);
    expect(el.type).not.toBe(LeadDetailEdu);
  });

  it("gives LeadDetailV2 exactly the props it had before (the legacy page is untouched)", async () => {
    tenant.current = mk("it_agency");
    const el = (await Page({ params })) as { props: Record<string, unknown> };
    expect(Object.keys(el.props).sort()).toEqual([
      "activeLeadLists", "activities", "applicationsActive", "assignableMembers", "bypassQualification", "canAssign", "canEditLeads",
      "canEnroll", "canManageApplicationPanel", "canManageApplications", "canMoveWithoutChain", "checkInActive", "checklists", "classesActive",
      "consentEnabled", "consentSigned", "documentsActive", "entity", "industry", "lead", "leadLists", "leadScope", "memberNames",
      "nextPositionMembers", "notes", "projectBoardEnabled", "revertTargetMembers", "revertTargetName", "revertTargetUserId", "role",
      "stageAssigneeMap", "stageScopedAssignees", "stages", "submissionHistory", "tenant", "userBranchId", "userId",
    ].sort());
  });
});
