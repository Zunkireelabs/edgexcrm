import { NextRequest } from "next/server";
import { authenticateRequest } from "@/lib/api/auth";
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

interface UserStats {
  hrs_this_month: number;
  last_active_at: string | null;
  is_active_90d: boolean;
}

async function lookupEmail(db: Awaited<ReturnType<typeof scopedClient>>, userId: string): Promise<string | null> {
  try {
    const { data } = await db.raw().auth.admin.getUserById(userId);
    return data?.user?.email ?? null;
  } catch { return null; }
}

export async function GET(_request: NextRequest, { params }: Props) {
  const { id } = await params;

  const auth = await authenticateRequest();
  if (!auth) return apiUnauthorized();
  if (!getFeatureAccess(auth.industryId, FEATURES.ACCOUNTS)) return apiForbidden();

  const db = await scopedClient(auth);

  // Verify account exists and get owner
  const { data: accountRow } = await db
    .from("accounts")
    .select("id, owner_id")
    .eq("id", id)
    .maybeSingle();
  if (!accountRow) return apiNotFound("Account");

  const account = accountRow as unknown as { id: string; owner_id: string | null };

  // Get project owner IDs + project counts for this account
  const { data: projectRows, error: projErr } = await db
    .from("projects")
    .select("id, owner_id")
    .eq("account_id", id);
  if (projErr) return apiError("DB_ERROR", "Failed to fetch projects", 500);

  const typedProjectRows = (projectRows ?? []) as unknown as { id: string; owner_id: string | null }[];
  const projectIds = typedProjectRows.map((p) => p.id);
  const projectOwnerMap = new Map<string, number>(); // owner_id → project count
  for (const p of typedProjectRows) {
    if (p.owner_id) projectOwnerMap.set(p.owner_id, (projectOwnerMap.get(p.owner_id) ?? 0) + 1);
  }

  const ownerSet = new Set<string>();
  if (account.owner_id) ownerSet.add(account.owner_id);
  for (const [oid] of projectOwnerMap) ownerSet.add(oid);

  // If no projects and no owner, nothing to show
  if (projectIds.length === 0 && !account.owner_id) {
    return apiSuccess({ owners: [], contributors: [] });
  }

  // Time entries (last 180 days) for compute hrs_this_month + last_active_at + 90d contributor check
  const now = new Date();
  const oneEightyDaysAgo = new Date(now.getTime() - 180 * 24 * 60 * 60 * 1000).toISOString();
  const ninetyDaysAgo = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);
  const thisMonthStart = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-01`;

  const userStats = new Map<string, UserStats>();

  if (projectIds.length > 0) {
    const { data: entries, error: entriesErr } = await db
      .from("time_entries")
      .select("user_id, minutes, entry_date, created_at")
      .in("project_id", projectIds)
      .gte("created_at", oneEightyDaysAgo);

    if (entriesErr) return apiError("DB_ERROR", "Failed to fetch time entries", 500);

    for (const entry of (entries ?? []) as unknown as { user_id: string; minutes: number; entry_date: string; created_at: string }[]) {
      const stats = userStats.get(entry.user_id) ?? { hrs_this_month: 0, last_active_at: null, is_active_90d: false };
      if (entry.entry_date >= thisMonthStart) {
        stats.hrs_this_month += entry.minutes / 60;
      }
      if (!stats.last_active_at || entry.created_at > stats.last_active_at) {
        stats.last_active_at = entry.created_at;
      }
      if (new Date(entry.created_at) >= ninetyDaysAgo) {
        stats.is_active_90d = true;
      }
      userStats.set(entry.user_id, stats);
    }
  }

  // Build owners list
  const owners: {
    user_id: string;
    email: string | null;
    role_label: "Account Manager" | "Project Lead";
    is_account_owner: boolean;
    owned_projects_count: number;
    hrs_this_month: number;
    last_active_at: string | null;
  }[] = [];

  if (account.owner_id) {
    const stats = userStats.get(account.owner_id) ?? { hrs_this_month: 0, last_active_at: null };
    owners.push({
      user_id: account.owner_id,
      email: null,
      role_label: "Account Manager",
      is_account_owner: true,
      owned_projects_count: projectOwnerMap.get(account.owner_id) ?? 0,
      hrs_this_month: stats.hrs_this_month,
      last_active_at: stats.last_active_at,
    });
  }

  for (const [ownerId, count] of projectOwnerMap) {
    if (ownerId === account.owner_id) continue; // already in owners as Account Manager
    const stats = userStats.get(ownerId) ?? { hrs_this_month: 0, last_active_at: null };
    owners.push({
      user_id: ownerId,
      email: null,
      role_label: "Project Lead",
      is_account_owner: false,
      owned_projects_count: count,
      hrs_this_month: stats.hrs_this_month,
      last_active_at: stats.last_active_at,
    });
  }

  // Sort: account owner first, then project leads by hrs desc
  owners.sort((a, b) => {
    if (a.is_account_owner) return -1;
    if (b.is_account_owner) return 1;
    return b.hrs_this_month - a.hrs_this_month;
  });

  // Build contributors list (active in last 90 days, not an owner)
  const contributors: {
    user_id: string;
    email: string | null;
    role_label: "Contributor";
    hrs_this_month: number;
    last_active_at: string;
  }[] = [];

  for (const [userId, stats] of userStats) {
    if (ownerSet.has(userId)) continue;
    if (!stats.is_active_90d) continue;
    contributors.push({
      user_id: userId,
      email: null,
      role_label: "Contributor",
      hrs_this_month: stats.hrs_this_month,
      last_active_at: stats.last_active_at ?? new Date().toISOString(),
    });
  }

  contributors.sort((a, b) => b.hrs_this_month - a.hrs_this_month);

  // Email lookups in parallel
  const allUserIds = [...owners.map((o) => o.user_id), ...contributors.map((c) => c.user_id)];
  const emailResults = await Promise.all(allUserIds.map((uid) => lookupEmail(db, uid)));
  const emailMap = new Map(allUserIds.map((uid, i) => [uid, emailResults[i]]));

  for (const o of owners) o.email = emailMap.get(o.user_id) ?? null;
  for (const c of contributors) c.email = emailMap.get(c.user_id) ?? null;

  return apiSuccess({ owners, contributors });
}
