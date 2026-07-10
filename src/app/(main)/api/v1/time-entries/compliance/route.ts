import { NextRequest } from "next/server";
import { authenticateRequest, requireAdmin } from "@/lib/api/auth";
import { apiSuccess, apiUnauthorized, apiForbidden, apiValidationError, apiError } from "@/lib/api/response";
import { createRequestLogger } from "@/lib/logger";
import { scopedClient } from "@/lib/supabase/scoped";
import { getFeatureAccess } from "@/industries/_loader";
import { FEATURES } from "@/industries/_registry";
import { todayInTz, isWorkingDay, addDays, dayOfWeek } from "@/lib/hr/dates";
import { daysInRange, buildApprovedLeaveDates } from "@/lib/hr/attendance";
import { getHolidaySet } from "@/lib/hr/leave";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

type ComplianceStatus = "no_logs" | "gaps" | "on_track" | "none";

interface ComplianceRow {
  tenantUserId: string;
  userId: string;
  name: string | null;
  email: string;
  role: string;
  workingDays: number;
  loggedDays: number;
  missingDays: string[];
  leaveDays: string[];
  totalMinutes: number;
  perDayMinutes: Record<string, number>;
  status: ComplianceStatus;
}

interface TenantUserRow {
  id: string;
  user_id: string;
  role: string;
}

/** Monday of the ISO week containing `dateISO` (tz-less string, matches dayOfWeek's UTC-string convention). */
function mondayOf(dateISO: string): string {
  const dow = dayOfWeek(dateISO);
  const offset = dow === 0 ? -6 : 1 - dow;
  return addDays(dateISO, offset);
}

export async function GET(request: NextRequest) {
  const requestId = crypto.randomUUID();
  const log = createRequestLogger({
    requestId,
    method: "GET",
    path: "/api/v1/time-entries/compliance",
  });

  const auth = await authenticateRequest();
  if (!auth) return apiUnauthorized();
  if (!getFeatureAccess(auth.industryId, FEATURES.TIME_TRACKING)) return apiForbidden();
  if (!requireAdmin(auth)) return apiForbidden();

  const db = await scopedClient(auth);

  const { searchParams } = new URL(request.url);
  const fromParam = searchParams.get("from");
  const toParam = searchParams.get("to");
  if (fromParam && !DATE_RE.test(fromParam)) {
    return apiValidationError({ from: ["Must be YYYY-MM-DD"] });
  }
  if (toParam && !DATE_RE.test(toParam)) {
    return apiValidationError({ to: ["Must be YYYY-MM-DD"] });
  }

  const { data: tenantRow } = await db
    .raw()
    .from("tenants")
    .select("timezone, weekend_days")
    .eq("id", auth.tenantId)
    .single();
  const tenantLocale = tenantRow as { timezone: string; weekend_days: number[] } | null;
  const weekendDays = tenantLocale?.weekend_days ?? [6];
  const timezone = tenantLocale?.timezone ?? "Asia/Kathmandu";
  const todayISO = todayInTz(timezone);

  // Default range: current ISO week (Monday) through today — mirrors the timesheet's default week.
  const from = fromParam ?? mondayOf(todayISO);
  const to = toParam ?? todayISO;
  if (from > to) {
    return apiValidationError({ to: ["to cannot be before from"] });
  }

  // Missing-day calc never reaches into today/future (decision #3) — a
  // partially-logged today is never flagged. `to` beyond today is clamped.
  const yesterdayISO = addDays(todayISO, -1);
  const effectiveEnd = to < yesterdayISO ? to : yesterdayISO;

  // Holidays: v1 is tenant-wide only (branch-scoped holidays deferred — see brief §8).
  const holidaySet = await getHolidaySet(db, null, from, to);
  const workingDaysFinal = daysInRange(from, effectiveEnd).filter((d) => isWorkingDay(d, weekendDays, holidaySet));

  const { data: membersData, error: membersError } = await db
    .from("tenant_users")
    .select("id, user_id, role");
  if (membersError) {
    log.error({ error: membersError }, "Failed to fetch tenant members");
    return apiError("DB_ERROR", "Failed to fetch tenant members", 500);
  }
  const members = (membersData ?? []) as unknown as TenantUserRow[];
  const memberIds = members.map((m) => m.id);

  if (memberIds.length === 0) {
    return apiSuccess({ from, to, todayISO, rows: [], summary: { members: 0, fullyLogged: 0, withGaps: 0, noLogs: 0 } });
  }

  const { data: entriesData, error: entriesError } = await db
    .from("time_entries")
    .select("user_id, entry_date, minutes")
    .gte("entry_date", from)
    .lte("entry_date", to);
  if (entriesError) {
    log.error({ error: entriesError }, "Failed to fetch time entries");
    return apiError("DB_ERROR", "Failed to fetch time entries", 500);
  }
  const perUserPerDay = new Map<string, Map<string, number>>();
  for (const e of (entriesData ?? []) as unknown as { user_id: string; entry_date: string; minutes: number }[]) {
    const dayMap = perUserPerDay.get(e.user_id) ?? new Map<string, number>();
    dayMap.set(e.entry_date, (dayMap.get(e.entry_date) ?? 0) + e.minutes);
    perUserPerDay.set(e.user_id, dayMap);
  }

  const { data: leaveData, error: leaveError } = await db
    .from("leave_requests")
    .select("tenant_user_id, start_date, end_date")
    .in("tenant_user_id", memberIds)
    .eq("approval_status", "approved")
    .lte("start_date", to)
    .gte("end_date", from);
  if (leaveError) {
    log.error({ error: leaveError }, "Failed to fetch approved leave");
    return apiError("DB_ERROR", "Failed to fetch approved leave", 500);
  }
  const leaveByMember = new Map<string, { start_date: string; end_date: string }[]>();
  for (const r of (leaveData ?? []) as unknown as { tenant_user_id: string; start_date: string; end_date: string }[]) {
    const list = leaveByMember.get(r.tenant_user_id) ?? [];
    list.push(r);
    leaveByMember.set(r.tenant_user_id, list);
  }

  const { data: authData } = await db.raw().auth.admin.listUsers({ perPage: 1000 });
  const nameMap = new Map<string, string | null>();
  const emailMap = new Map<string, string>();
  for (const u of authData?.users || []) {
    emailMap.set(u.id, u.email || "");
    const meta = u.user_metadata as Record<string, unknown> | undefined;
    nameMap.set(u.id, (meta?.name ?? meta?.full_name ?? null) as string | null);
  }

  const rows: ComplianceRow[] = members.map((m) => {
    // Half-day leave is treated as a full leave-covered day for the missing
    // calc in v1 (a half-day usually pairs with a partial log or is a wash) —
    // buildApprovedLeaveDates already resolves whole vs partial spans.
    const approvedLeaveDates = buildApprovedLeaveDates(leaveByMember.get(m.id) ?? [], weekendDays, holidaySet, from, to);
    const perDay = perUserPerDay.get(m.user_id) ?? new Map<string, number>();

    const missingDays: string[] = [];
    const leaveDays: string[] = [];
    const perDayMinutes: Record<string, number> = {};
    let loggedDays = 0;
    let totalMinutes = 0;

    for (const d of workingDaysFinal) {
      const minutes = perDay.get(d) ?? 0;
      perDayMinutes[d] = minutes;
      totalMinutes += minutes;
      if (approvedLeaveDates.has(d)) {
        leaveDays.push(d);
      } else if (minutes === 0) {
        missingDays.push(d);
      } else {
        loggedDays++;
      }
    }

    let status: ComplianceStatus;
    if (workingDaysFinal.length === 0) status = "none";
    else if (loggedDays === 0) status = "no_logs";
    else if (missingDays.length > 0) status = "gaps";
    else status = "on_track";

    return {
      tenantUserId: m.id,
      userId: m.user_id,
      name: nameMap.get(m.user_id) ?? null,
      email: emailMap.get(m.user_id) || "Unknown",
      role: m.role,
      workingDays: workingDaysFinal.length,
      loggedDays,
      missingDays,
      leaveDays,
      totalMinutes,
      perDayMinutes,
      status,
    };
  });

  rows.sort((a, b) => b.missingDays.length - a.missingDays.length);

  const summary = {
    members: rows.length,
    fullyLogged: rows.filter((r) => r.status === "on_track" || r.status === "none").length,
    withGaps: rows.filter((r) => r.status === "gaps").length,
    noLogs: rows.filter((r) => r.status === "no_logs").length,
  };

  return apiSuccess({ from, to, todayISO, rows, summary });
}
