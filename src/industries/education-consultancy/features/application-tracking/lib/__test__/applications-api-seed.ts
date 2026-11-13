// TEST-ONLY seed for the applications API scope tests (GET /api/v1/applications and
// GET /api/v1/applications/board-page). Never import from app code.
import { createFakeSupabase } from "./fake-postgrest";

export const T = "tenant-1";
const u = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
export const ME = u(1); // own-scope counsellor
export const B1A = u(2); // branch b1 members
export const B1B = u(3);
export const OUT = u(4); // someone outside b1
export const MANAGER = u(5); // team-scope manager of b1
export const ADMIN = u(6);
export const P = u(100);
export const S1 = u(201);
export const S2 = u(202);
export const S3 = u(203); // finished

const OWNERS = [B1A, B1B, OUT, ME, null];
export const LEADS = 1200;

/** lead i -> its assignee. ME can also see every lead with i % 50 === 2 as a collaborator (assigned to OUT). */
export const leadOwner = (i: number) => OWNERS[i % OWNERS.length];
export const meCanSee = (i: number) => leadOwner(i) === ME || i % 50 === 2;
export const inBranch = (i: number) => leadOwner(i) === B1A || leadOwner(i) === B1B;

export const APPS = Array.from({ length: LEADS }, (_, i) => ({
  id: `app-${String(i).padStart(5, "0")}`,
  tenant_id: T,
  lead_id: `lead-${i}`,
  assigned_to: null,
  university_name: i % 7 === 0 ? "Harvard University" : "Monash University",
  program_name: "MBA",
  intake_term: null,
  countries: i % 3 === 0 ? ["UK"] : ["Australia"],
  offer_type: null,
  pipeline_id: P,
  stage_id: [S1, S2, S3][i % 3],
  status: i % 2 === 0 ? "open" : "sent",
  stage_changed_at: new Date(Date.UTC(2026, 0, 1 + (i % 50))).toISOString(),
  created_at: new Date(Date.UTC(2026, 0, 1, 0, i)).toISOString(),
  updated_at: new Date(Date.UTC(2026, 0, 1)).toISOString(),
  application_deadline: null,
  deleted_at: null,
  leads: { id: `lead-${i}`, first_name: "Sam", last_name: `Lee${i}`, email: `s${i}@x.test`, assigned_to: leadOwner(i), deleted_at: null },
  application_stages: null,
}));

export function seedDb() {
  return createFakeSupabase({
    applications: APPS as never,
    visible_leads: APPS.filter((_, i) => meCanSee(i)).map((a) => ({ id: a.lead_id, deleted_at: null })),
    tenant_users: [
      { tenant_id: T, branch_id: "b1", user_id: B1A },
      { tenant_id: T, branch_id: "b1", user_id: B1B },
      { tenant_id: T, branch_id: "b1", user_id: MANAGER },
      { tenant_id: T, branch_id: "b2", user_id: OUT },
    ],
    tenants: [{ id: T, timezone: "UTC" }],
    application_stages: [
      { id: S1, tenant_id: T, pipeline_id: P, name: "Applied", position: 0, is_default: true, is_terminal: false, terminal_type: null },
      { id: S2, tenant_id: T, pipeline_id: P, name: "Offer", position: 1, is_default: false, is_terminal: false, terminal_type: null },
      { id: S3, tenant_id: T, pipeline_id: P, name: "Enrolled", position: 2, is_default: false, is_terminal: true, terminal_type: "won" },
    ],
    application_pipelines: [{ id: P, tenant_id: T, name: "Default", is_default: true, position: 0, is_active: true }],
    applicant_documents: [],
    tasks: [],
  });
}

const perms = (leadScope: "own" | "team" | "all", baseTier: "owner" | "admin" | "member") => ({
  baseTier, leadScope, pipelineAccess: "all", canManageApplications: true,
});
export const AUTH = {
  counsellor: { userId: ME, email: "me@x", tenantId: T, role: "staff", industryId: "education_consultancy", positionId: null, positionSlug: null, branchId: null, branchMemberIds: [], permissions: perms("own", "member") },
  manager: { userId: MANAGER, email: "m@x", tenantId: T, role: "staff", industryId: "education_consultancy", positionId: null, positionSlug: null, branchId: "b1", branchMemberIds: [B1A, B1B, MANAGER], permissions: perms("team", "member") },
  admin: { userId: ADMIN, email: "a@x", tenantId: T, role: "admin", industryId: "education_consultancy", positionId: null, positionSlug: null, branchId: null, branchMemberIds: [], permissions: perms("all", "admin") },
};
