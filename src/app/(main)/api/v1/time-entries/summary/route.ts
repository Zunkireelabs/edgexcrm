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
const VALID_DIMENSIONS = ["member", "project", "account"] as const;
type Dimension = (typeof VALID_DIMENSIONS)[number];

interface SummaryRow {
  key: string;
  label: string;
  minutes: number;
  billable_minutes: number;
  billable_amount: number;
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

  // Group entries by dimension key
  const groups = new Map<string, EntryWithJoins[]>();

  for (const entry of entries) {
    let key: string;
    if (dimension === "member") {
      key = entry.user_id;
    } else if (dimension === "project") {
      key = entry.project_id ?? "unknown";
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
    } else {
      label = grp[0]?.projects?.accounts?.name ?? (key === "unassigned" ? "Unassigned" : key);
    }

    rows.push({
      key,
      label,
      minutes: grp.reduce((sum, e) => sum + e.minutes, 0),
      billable_minutes: calculateBillableMinutes(grp as TimeEntry[]),
      billable_amount: calculateBillableAmount(grp as TimeEntry[]),
    });
  }

  // Sort by total minutes desc
  rows.sort((a, b) => b.minutes - a.minutes);

  return apiSuccess(rows);
}
