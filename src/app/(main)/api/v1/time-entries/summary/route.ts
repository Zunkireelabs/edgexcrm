import { NextRequest } from "next/server";
import { authenticateRequest, requireAdmin } from "@/lib/api/auth";
import { shouldRestrictToSelf } from "@/lib/api/permissions";
import {
  apiSuccess,
  apiUnauthorized,
  apiForbidden,
  apiValidationError,
  apiError,
} from "@/lib/api/response";
import { createRequestLogger } from "@/lib/logger";
import { scopedClient } from "@/lib/supabase/scoped";
import { getFeatureAccess } from "@/industries/_loader";
import { FEATURES } from "@/industries/_registry";
import { calculateBillableMinutes, calculateBillableAmount } from "@/industries/it-agency/features/time-tracking/lib/totals";
import type { TimeEntry } from "@/types/database";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const VALID_DIMENSIONS = ["member", "project", "account", "department"] as const;
type Dimension = (typeof VALID_DIMENSIONS)[number];

interface SummaryRow {
  key: string;
  label: string;
  minutes: number;
  billable_minutes: number;
  billable_amount: number;
  currency: string;
}

interface EntryWithJoins extends TimeEntry {
  projects: {
    id: string;
    name: string;
    account_id: string | null;
    accounts: { id: string; name: string } | null;
  } | null;
}

export async function GET(request: NextRequest) {
  const requestId = crypto.randomUUID();
  const log = createRequestLogger({
    requestId,
    method: "GET",
    path: "/api/v1/time-entries/summary",
  });

  const auth = await authenticateRequest();
  if (!auth) return apiUnauthorized();
  if (!getFeatureAccess(auth.industryId, FEATURES.TIME_TRACKING)) return apiForbidden();

  const { searchParams } = new URL(request.url);
  const dimension = searchParams.get("dimension") as Dimension | null;
  const from = searchParams.get("from");
  const to = searchParams.get("to");

  if (!dimension || !VALID_DIMENSIONS.includes(dimension)) {
    return apiValidationError({
      dimension: [`Must be one of: ${VALID_DIMENSIONS.join(", ")}`],
    });
  }
  if (from && !DATE_RE.test(from)) {
    return apiValidationError({ from: ["Must be YYYY-MM-DD"] });
  }
  if (to && !DATE_RE.test(to)) {
    return apiValidationError({ to: ["Must be YYYY-MM-DD"] });
  }

  const db = await scopedClient(auth);
  const isAdmin = requireAdmin(auth);

  const { data: tenantRow } = await db.raw().from("tenants").select("default_currency").eq("id", auth.tenantId).single();
  const currency = (tenantRow as { default_currency: string } | null)?.default_currency ?? "NPR";

  let query = db
    .from("time_entries")
    .select("*, projects!time_entries_project_id_fkey(id, name, account_id, accounts(id, name))");

  // Non-admins (including counselors) only see their own entries
  if (!isAdmin) {
    query = query.eq("user_id", auth.userId);
  }
  if (from) query = query.gte("entry_date", from);
  if (to) query = query.lte("entry_date", to);

  const { data, error } = await query;
  if (error) {
    log.error({ error }, "Failed to fetch time entries for summary");
    return apiError("DB_ERROR", "Failed to fetch time entries", 500);
  }

  const entries = (data ?? []) as unknown as EntryWithJoins[];

  // dimension=department needs a user_id -> department lookup: time_entries.user_id
  // (auth.users.id) -> tenant_users.user_id -> tenant_users.id -> employee_profiles.department_id
  // -> departments.name. Members without a profile/department land in "Unassigned".
  let departmentByUserId: Map<string, { key: string; label: string }> | null = null;
  if (dimension === "department") {
    const [{ data: tenantUsersRaw, error: tuError }, { data: departmentsRaw, error: deptError }] = await Promise.all([
      db
        .from("tenant_users")
        .select("user_id, employee_profiles!employee_profiles_tenant_user_id_fkey(department_id)"),
      db.from("departments").select("id, name"),
    ]);
    if (tuError || deptError) {
      log.error({ tuError, deptError }, "Failed to fetch department lookups for summary");
      return apiError("DB_ERROR", "Failed to fetch department data", 500);
    }

    const departmentNameById = new Map(
      ((departmentsRaw ?? []) as unknown as Array<{ id: string; name: string }>).map((d) => [d.id, d.name])
    );

    departmentByUserId = new Map();
    for (const tu of (tenantUsersRaw ?? []) as unknown as Array<{
      user_id: string;
      employee_profiles: { department_id: string | null } | { department_id: string | null }[] | null;
    }>) {
      const profile = Array.isArray(tu.employee_profiles) ? tu.employee_profiles[0] ?? null : tu.employee_profiles;
      const departmentId = profile?.department_id ?? null;
      departmentByUserId.set(tu.user_id, {
        key: departmentId ?? "unassigned",
        label: departmentId ? departmentNameById.get(departmentId) ?? "Unknown" : "Unassigned",
      });
    }
  }

  // Group entries by dimension key
  const groups = new Map<string, EntryWithJoins[]>();

  for (const entry of entries) {
    let key: string;
    if (dimension === "member") {
      key = entry.user_id;
    } else if (dimension === "project") {
      key = entry.project_id ?? "unknown";
    } else if (dimension === "department") {
      key = departmentByUserId?.get(entry.user_id)?.key ?? "unassigned";
    } else {
      // account
      key = entry.projects?.account_id ?? "unassigned";
    }

    const g = groups.get(key) ?? [];
    g.push(entry);
    groups.set(key, g);
  }

  // Counselor safety net: dimension=member can only contain their own row
  const rows: SummaryRow[] = [];
  for (const [key, grp] of groups) {
    if (dimension === "member" && shouldRestrictToSelf(auth.permissions) && key !== auth.userId) {
      continue;
    }

    let label: string;
    if (dimension === "member") {
      label = key;
    } else if (dimension === "project") {
      label = grp[0]?.projects?.name ?? key;
    } else if (dimension === "department") {
      label = departmentByUserId?.get(grp[0]?.user_id)?.label ?? (key === "unassigned" ? "Unassigned" : key);
    } else {
      label = grp[0]?.projects?.accounts?.name ?? (key === "unassigned" ? "Unassigned" : key);
    }

    rows.push({
      key,
      label,
      minutes: grp.reduce((sum, e) => sum + e.minutes, 0),
      billable_minutes: calculateBillableMinutes(grp as TimeEntry[]),
      billable_amount: calculateBillableAmount(grp as TimeEntry[]),
      currency,
    });
  }

  // Sort by total minutes desc
  rows.sort((a, b) => b.minutes - a.minutes);

  return apiSuccess(rows);
}
