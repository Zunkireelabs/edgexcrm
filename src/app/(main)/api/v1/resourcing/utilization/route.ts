import { authenticateRequest } from "@/lib/api/auth";
import { canManageHR } from "@/lib/api/permissions";
import { apiSuccess, apiUnauthorized, apiForbidden, apiError } from "@/lib/api/response";
import { scopedClient } from "@/lib/supabase/scoped";
import { getFeatureAccess } from "@/industries/_loader";
import { FEATURES } from "@/industries/_registry";
import { getSelfTenantUserId, getDirectReportIds } from "@/lib/api/hr-scope";
import type { TimeEntry } from "@/types/database";

const DEFAULT_WEEKLY_CAPACITY_HOURS = 40;

interface AllocationRow {
  id: string;
  project_id: string;
  hours_per_week: number;
  role_on_project: string | null;
  projects: { id: string; name: string } | { id: string; name: string }[] | null;
}

export async function GET() {
  const auth = await authenticateRequest();
  if (!auth) return apiUnauthorized();
  if (!getFeatureAccess(auth.industryId, FEATURES.RESOURCING)) return apiForbidden();

  const db = await scopedClient(auth);
  const hasManageHR = canManageHR(auth.permissions);
  const selfId = await getSelfTenantUserId(db, auth);

  let membersQuery = db
    .from("tenant_users")
    .select("id, user_id, employee_profiles(weekly_capacity_hours)");

  if (!hasManageHR) {
    const directReportIds = selfId ? await getDirectReportIds(db, selfId) : [];
    const allowedIds = [selfId, ...directReportIds].filter((v): v is string => !!v);
    if (allowedIds.length === 0) return apiSuccess([]);
    membersQuery = membersQuery.in("id", allowedIds);
  }

  const { data: membersRaw, error: membersError } = await membersQuery;
  if (membersError) return apiError("DB_ERROR", "Failed to fetch employees", 500);

  const members = (membersRaw ?? []) as unknown as Array<{
    id: string;
    user_id: string;
    employee_profiles: { weekly_capacity_hours: number } | { weekly_capacity_hours: number }[] | null;
  }>;
  if (members.length === 0) return apiSuccess([]);

  const memberIds = members.map((m) => m.id);
  const userIdByTenantUserId = new Map(members.map((m) => [m.id, m.user_id]));

  // Numerator: approved + billable minutes from time_entries, same rule as
  // /api/v1/time-entries/summary?dimension=member. Joined via user_id (both
  // tenant_users.user_id and time_entries.user_id reference auth.users.id).
  const userIds = members.map((m) => m.user_id);
  const { data: entriesRaw, error: entriesError } = await db
    .from("time_entries")
    .select("user_id, minutes, is_billable, approval_status")
    .in("user_id", userIds);
  if (entriesError) return apiError("DB_ERROR", "Failed to fetch time entries", 500);

  const billableMinutesByUserId = new Map<string, number>();
  for (const e of (entriesRaw ?? []) as unknown as Pick<TimeEntry, "user_id" | "minutes" | "is_billable" | "approval_status">[]) {
    if (!e.is_billable || e.approval_status !== "approved") continue;
    billableMinutesByUserId.set(e.user_id, (billableMinutesByUserId.get(e.user_id) ?? 0) + e.minutes);
  }

  // Phase 2: subtract approved leave from capacityHours once leave is built.
  const { data: allocationsRaw, error: allocationsError } = await db
    .from("project_allocations")
    .select("id, project_id, tenant_user_id, hours_per_week, role_on_project, projects!project_allocations_project_id_fkey(id, name)")
    .in("tenant_user_id", memberIds);
  if (allocationsError) return apiError("DB_ERROR", "Failed to fetch project allocations", 500);

  const allocationsByMember = new Map<string, AllocationRow[]>();
  for (const a of (allocationsRaw ?? []) as unknown as Array<AllocationRow & { tenant_user_id: string }>) {
    const list = allocationsByMember.get(a.tenant_user_id) ?? [];
    list.push(a);
    allocationsByMember.set(a.tenant_user_id, list);
  }

  const result = members.map((m) => {
    const profile = Array.isArray(m.employee_profiles) ? m.employee_profiles[0] ?? null : m.employee_profiles;
    const capacityHours = profile?.weekly_capacity_hours ?? DEFAULT_WEEKLY_CAPACITY_HOURS;
    const billableHours = (billableMinutesByUserId.get(userIdByTenantUserId.get(m.id) ?? "") ?? 0) / 60;
    const allocations = (allocationsByMember.get(m.id) ?? []).map((a) => {
      const project = Array.isArray(a.projects) ? a.projects[0] ?? null : a.projects;
      return {
        id: a.id,
        project_id: a.project_id,
        project_name: project?.name ?? null,
        hours_per_week: a.hours_per_week,
        role_on_project: a.role_on_project,
      };
    });
    return {
      tenant_user_id: m.id,
      billableHours,
      capacityHours,
      utilizationPct: capacityHours > 0 ? Math.round((billableHours / capacityHours) * 1000) / 10 : 0,
      allocations,
    };
  });

  return apiSuccess(result);
}
