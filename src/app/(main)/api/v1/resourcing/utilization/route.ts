import { authenticateRequest } from "@/lib/api/auth";
import { canManageHR } from "@/lib/api/permissions";
import { apiSuccess, apiUnauthorized, apiForbidden, apiError } from "@/lib/api/response";
import { scopedClient } from "@/lib/supabase/scoped";
import { getFeatureAccess } from "@/industries/_loader";
import { FEATURES } from "@/industries/_registry";
import { getSelfTenantUserId, getDirectReportIds } from "@/lib/api/hr-scope";
import { getHolidaySet } from "@/lib/hr/leave";
import { countLeaveDays, workingDaysPerWeek, todayInTz } from "@/lib/hr/dates";
import type { TimeEntry } from "@/types/database";

const DEFAULT_WEEKLY_CAPACITY_HOURS = 40;

/** Monday–Sunday week containing todayISO (calendar math on the date string, tz-agnostic). */
function currentWeekRange(todayISO: string): { weekStart: string; weekEnd: string } {
  const d = new Date(`${todayISO}T00:00:00Z`);
  const day = d.getUTCDay();
  const mondayOffset = day === 0 ? -6 : 1 - day;
  d.setUTCDate(d.getUTCDate() + mondayOffset);
  const weekStart = d.toISOString().slice(0, 10);
  d.setUTCDate(d.getUTCDate() + 6);
  const weekEnd = d.toISOString().slice(0, 10);
  return { weekStart, weekEnd };
}

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
    .select("id, user_id, branch_id, employee_profiles!employee_profiles_tenant_user_id_fkey(weekly_capacity_hours)");

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
    branch_id: string | null;
    employee_profiles: { weekly_capacity_hours: number } | { weekly_capacity_hours: number }[] | null;
  }>;
  if (members.length === 0) return apiSuccess([]);

  const memberIds = members.map((m) => m.id);
  const userIdByTenantUserId = new Map(members.map((m) => [m.id, m.user_id]));

  // Reporting week (Mon–Sun) — used both to scope the numerator (time entries)
  // and to subtract approved leave from the denominator (weekly capacity), so
  // utilization% compares like-for-like periods.
  const { data: tenantLocale } = await db
    .raw()
    .from("tenants")
    .select("timezone, weekend_days")
    .eq("id", auth.tenantId)
    .single();
  const locale = tenantLocale as unknown as { timezone: string; weekend_days: number[] } | null;
  const weekendDays = locale?.weekend_days ?? [6];
  const { weekStart, weekEnd } = currentWeekRange(todayInTz(locale?.timezone ?? "Asia/Kathmandu"));

  // Numerator: approved + billable minutes from time_entries THIS WEEK, same
  // rule as /api/v1/time-entries/summary?dimension=member plus a week scope.
  // Joined via user_id (both tenant_users.user_id and time_entries.user_id
  // reference auth.users.id).
  const userIds = members.map((m) => m.user_id);
  const { data: entriesRaw, error: entriesError } = await db
    .from("time_entries")
    .select("user_id, minutes, is_billable, approval_status")
    .in("user_id", userIds)
    .gte("entry_date", weekStart)
    .lte("entry_date", weekEnd);
  if (entriesError) return apiError("DB_ERROR", "Failed to fetch time entries", 500);

  const billableMinutesByUserId = new Map<string, number>();
  for (const e of (entriesRaw ?? []) as unknown as Pick<TimeEntry, "user_id" | "minutes" | "is_billable" | "approval_status">[]) {
    if (!e.is_billable || e.approval_status !== "approved") continue;
    billableMinutesByUserId.set(e.user_id, (billableMinutesByUserId.get(e.user_id) ?? 0) + e.minutes);
  }

  const { data: leaveRaw, error: leaveError } = await db
    .from("leave_requests")
    .select("tenant_user_id, start_date, end_date, start_half, end_half")
    .in("tenant_user_id", memberIds)
    .eq("approval_status", "approved")
    .lte("start_date", weekEnd)
    .gte("end_date", weekStart);
  if (leaveError) return apiError("DB_ERROR", "Failed to fetch approved leave", 500);

  const branchIdByMember = new Map(members.map((m) => [m.id, m.branch_id]));
  const holidaySetByBranch = new Map<string, Set<string>>();
  async function holidaysForBranch(branchId: string | null): Promise<Set<string>> {
    const key = branchId ?? "__tenant_default__";
    if (!holidaySetByBranch.has(key)) {
      holidaySetByBranch.set(key, await getHolidaySet(db, branchId, weekStart, weekEnd));
    }
    return holidaySetByBranch.get(key)!;
  }

  const leaveDaysThisWeekByMember = new Map<string, number>();
  for (const l of (leaveRaw ?? []) as unknown as Array<{
    tenant_user_id: string;
    start_date: string;
    end_date: string;
    start_half: boolean;
    end_half: boolean;
  }>) {
    const effectiveStart = l.start_date > weekStart ? l.start_date : weekStart;
    const effectiveEnd = l.end_date < weekEnd ? l.end_date : weekEnd;
    const holidays = await holidaysForBranch(branchIdByMember.get(l.tenant_user_id) ?? null);
    const days = countLeaveDays(effectiveStart, effectiveEnd, {
      weekendDays,
      holidays,
      startHalf: l.start_half && effectiveStart === l.start_date,
      endHalf: l.end_half && effectiveEnd === l.end_date,
    });
    leaveDaysThisWeekByMember.set(l.tenant_user_id, (leaveDaysThisWeekByMember.get(l.tenant_user_id) ?? 0) + days);
  }

  const dailyHoursDivisor = workingDaysPerWeek(weekendDays) || 5;

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

    const leaveDaysThisWeek = leaveDaysThisWeekByMember.get(m.id) ?? 0;
    const dailyHours = capacityHours / dailyHoursDivisor;
    const leaveHours = leaveDaysThisWeek * dailyHours;
    const netCapacityHours = Math.max(0, capacityHours - leaveHours);

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
      leaveHoursThisWeek: leaveHours,
      netCapacityHours,
      utilizationPct: netCapacityHours > 0 ? Math.round((billableHours / netCapacityHours) * 1000) / 10 : 0,
      allocations,
    };
  });

  return apiSuccess(result);
}
