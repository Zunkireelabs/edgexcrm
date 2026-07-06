import { NextRequest } from "next/server";
import { authenticateRequest } from "@/lib/api/auth";
import { canManageHR } from "@/lib/api/permissions";
import { apiSuccess, apiUnauthorized, apiForbidden, apiError } from "@/lib/api/response";
import { scopedClient } from "@/lib/supabase/scoped";
import { getSelfTenantUserId, getDirectReportIds } from "@/lib/api/hr-scope";
import { getHolidaySet } from "@/lib/hr/leave";
import { todayInTz } from "@/lib/hr/dates";
import { daysInRange, buildApprovedLeaveDates, buildMemberDays, type AttendanceRecordLike } from "@/lib/hr/attendance";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_RANGE_DAYS = 62;

interface TenantUserRow {
  id: string;
  user_id: string;
  branch_id: string | null;
}

export async function GET(request: NextRequest) {
  const auth = await authenticateRequest();
  if (!auth) return apiUnauthorized();

  const db = await scopedClient(auth);
  const hasManageHR = canManageHR(auth.permissions);
  const selfId = await getSelfTenantUserId(db, auth);
  if (!selfId) return apiError("NOT_FOUND", "No tenant membership found for the current user", 404);

  const { searchParams } = new URL(request.url);
  const scope = searchParams.get("scope") ?? "mine";
  const from = searchParams.get("from");
  const to = searchParams.get("to");
  if (!from || !to || !DATE_RE.test(from) || !DATE_RE.test(to)) {
    return apiError("VALIDATION_ERROR", "from and to (YYYY-MM-DD) are required", 400);
  }
  if (to < from) return apiError("VALIDATION_ERROR", "to cannot be before from", 400);

  const dates = daysInRange(from, to);
  if (dates.length > MAX_RANGE_DAYS) {
    return apiError("VALIDATION_ERROR", `Range cannot exceed ${MAX_RANGE_DAYS} days`, 400);
  }

  let memberIds: string[];
  if (scope === "all") {
    if (!hasManageHR) return apiForbidden();
    const { data } = await db.from("tenant_users").select("id");
    memberIds = ((data ?? []) as unknown as { id: string }[]).map((r) => r.id);
  } else if (scope === "team") {
    memberIds = await getDirectReportIds(db, selfId);
    if (memberIds.length === 0) return apiSuccess([]);
  } else {
    memberIds = [selfId];
  }
  if (memberIds.length === 0) return apiSuccess([]);

  const { data: membersData } = await db
    .from("tenant_users")
    .select("id, user_id, branch_id")
    .in("id", memberIds);
  const members = (membersData ?? []) as unknown as TenantUserRow[];

  const { data: tenantRow } = await db.raw().from("tenants").select("timezone, weekend_days").eq("id", auth.tenantId).single();
  const tenantLocale = tenantRow as { timezone: string; weekend_days: number[] } | null;
  const weekendDays = tenantLocale?.weekend_days ?? [6];
  const todayISO = todayInTz(tenantLocale?.timezone ?? "Asia/Kathmandu");

  // Holiday set per distinct branch (a branch's effective calendar = its own + tenant defaults).
  const branchIds = Array.from(new Set(members.map((m) => m.branch_id)));
  const holidaySets = new Map<string | null, Set<string>>();
  await Promise.all(
    branchIds.map(async (branchId) => {
      holidaySets.set(branchId, await getHolidaySet(db, branchId, from, to));
    }),
  );

  const { data: leaveData } = await db
    .from("leave_requests")
    .select("tenant_user_id, start_date, end_date")
    .in("tenant_user_id", memberIds)
    .eq("approval_status", "approved")
    .lte("start_date", to)
    .gte("end_date", from);
  const leaveByMember = new Map<string, { start_date: string; end_date: string }[]>();
  for (const r of (leaveData ?? []) as unknown as { tenant_user_id: string; start_date: string; end_date: string }[]) {
    const list = leaveByMember.get(r.tenant_user_id) ?? [];
    list.push(r);
    leaveByMember.set(r.tenant_user_id, list);
  }

  const { data: recordsData } = await db
    .from("attendance_records")
    .select("tenant_user_id, work_date, clock_in_at, clock_out_at, status, source, note")
    .in("tenant_user_id", memberIds)
    .gte("work_date", from)
    .lte("work_date", to);
  const recordsByMember = new Map<string, Map<string, AttendanceRecordLike>>();
  for (const r of (recordsData ?? []) as unknown as ({ tenant_user_id: string; work_date: string } & AttendanceRecordLike)[]) {
    const map = recordsByMember.get(r.tenant_user_id) ?? new Map<string, AttendanceRecordLike>();
    map.set(r.work_date, { status: r.status, clock_in_at: r.clock_in_at, clock_out_at: r.clock_out_at, source: r.source, note: r.note });
    recordsByMember.set(r.tenant_user_id, map);
  }

  const { data: authData } = await db.raw().auth.admin.listUsers({ perPage: 1000 });
  const nameMap = new Map<string, string | null>();
  const emailMap = new Map<string, string>();
  for (const u of authData?.users || []) {
    emailMap.set(u.id, u.email || "");
    const meta = u.user_metadata as Record<string, unknown> | undefined;
    nameMap.set(u.id, (meta?.name ?? meta?.full_name ?? null) as string | null);
  }

  const result = members.map((m) => {
    const holidays = holidaySets.get(m.branch_id) ?? new Set<string>();
    const approvedLeaveDates = buildApprovedLeaveDates(leaveByMember.get(m.id) ?? [], weekendDays, holidays, from, to);
    const days = buildMemberDays(dates, {
      weekendDays,
      holidays,
      approvedLeaveDates,
      recordsByDate: recordsByMember.get(m.id) ?? new Map<string, AttendanceRecordLike>(),
      todayISO,
    });
    return {
      tenant_user_id: m.id,
      user_id: m.user_id,
      name: nameMap.get(m.user_id) ?? null,
      email: emailMap.get(m.user_id) || "Unknown",
      days,
    };
  });

  return apiSuccess({ today: todayISO, members: result });
}
