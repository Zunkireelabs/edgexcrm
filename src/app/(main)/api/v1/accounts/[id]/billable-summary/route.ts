import { NextRequest } from "next/server";
import { authenticateRequest } from "@/lib/api/auth";
import { shouldRestrictToSelf } from "@/lib/api/permissions";
import {
  apiSuccess,
  apiUnauthorized,
  apiForbidden,
  apiNotFound,
  apiError,
} from "@/lib/api/response";
import { scopedClient } from "@/lib/supabase/scoped";
import { getFeatureAccess } from "@/industries/_loader";
import { FEATURES } from "@/industries/_registry";

interface Props {
  params: Promise<{ id: string }>;
}

interface BillableRow {
  minutes: number;
  rate_snapshot: number | null;
}

function sumEntries(data: BillableRow[]): { billable_minutes: number; billable_amount: number } {
  let billable_minutes = 0;
  let billable_amount = 0;
  for (const row of data) {
    billable_minutes += row.minutes;
    billable_amount += (row.minutes / 60) * (row.rate_snapshot ?? 0);
  }
  return { billable_minutes, billable_amount };
}

export async function GET(_request: NextRequest, { params }: Props) {
  const { id } = await params;

  const auth = await authenticateRequest();
  if (!auth) return apiUnauthorized();
  if (!getFeatureAccess(auth.industryId, FEATURES.ACCOUNTS)) return apiForbidden();

  const db = await scopedClient(auth);

  const { data: account } = await db.from("accounts").select("id").eq("id", id).maybeSingle();
  if (!account) return apiNotFound("Account");

  const { data: projectRows, error: projErr } = await db
    .from("projects")
    .select("id")
    .eq("account_id", id);
  if (projErr) return apiError("DB_ERROR", "Failed to fetch projects", 500);

  const projectIds = ((projectRows ?? []) as unknown as { id: string }[]).map((p) => p.id);
  const zero = { billable_minutes: 0, billable_amount: 0 };

  if (projectIds.length === 0) {
    return apiSuccess({
      this_month: zero,
      last_month: zero,
      lifetime: zero,
    });
  }

  const isCounselor = shouldRestrictToSelf(auth.permissions);
  const authUserId = auth.userId;

  const now = new Date();
  const thisMonthStart = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01`;
  const lastMonthDate = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const lastMonthStart = `${lastMonthDate.getFullYear()}-${String(lastMonthDate.getMonth() + 1).padStart(2, "0")}-01`;
  const lastMonthEnd = new Date(now.getFullYear(), now.getMonth(), 0);
  const lastMonthEndStr = `${lastMonthEnd.getFullYear()}-${String(lastMonthEnd.getMonth() + 1).padStart(2, "0")}-${String(lastMonthEnd.getDate()).padStart(2, "0")}`;

  function buildQuery(from?: string, to?: string) {
    let q = db
      .from("time_entries")
      .select("minutes, rate_snapshot")
      .in("project_id", projectIds)
      .eq("is_billable", true)
      .eq("approval_status", "approved");
    if (isCounselor) q = q.eq("user_id", authUserId);
    if (from) q = q.gte("entry_date", from);
    if (to) q = q.lte("entry_date", to);
    return q;
  }

  const [thisMonthRes, lastMonthRes, lifetimeRes] = await Promise.all([
    buildQuery(thisMonthStart),
    buildQuery(lastMonthStart, lastMonthEndStr),
    buildQuery(),
  ]);

  if (thisMonthRes.error || lastMonthRes.error || lifetimeRes.error) {
    return apiError("DB_ERROR", "Failed to fetch billable data", 500);
  }

  return apiSuccess({
    this_month: sumEntries((thisMonthRes.data ?? []) as unknown as BillableRow[]),
    last_month: sumEntries((lastMonthRes.data ?? []) as unknown as BillableRow[]),
    lifetime: sumEntries((lifetimeRes.data ?? []) as unknown as BillableRow[]),
  });
}
