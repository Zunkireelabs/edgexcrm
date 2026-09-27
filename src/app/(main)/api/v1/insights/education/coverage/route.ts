import { authenticateRequest } from "@/lib/api/auth";
import { apiSuccess, apiUnauthorized, apiForbidden, apiError } from "@/lib/api/response";
import { scopedClient } from "@/lib/supabase/scoped";
import { getFeatureAccess } from "@/industries/_loader";
import { FEATURES } from "@/industries/_registry";

// Powers the Coverage Meter widget — % of active-pipeline leads (excludes
// Archived + admin-only "migration-qc") with a live assignee. Window-independent
// standing health metric, unlike every other widget on this dashboard.
export async function GET() {
  const auth = await authenticateRequest();
  if (!auth) return apiUnauthorized();
  if (!getFeatureAccess(auth.industryId, FEATURES.INSIGHTS)) return apiForbidden();
  if (!getFeatureAccess(auth.industryId, FEATURES.TEAM_PERFORMANCE)) return apiForbidden();
  if (auth.role !== "owner" && auth.role !== "admin") return apiForbidden();

  const db = await scopedClient(auth);

  const { data: lists, error: listsError } = await db.from("lead_lists").select("id, is_archive, slug");
  if (listsError) return apiError("DB_ERROR", "Failed to load lead lists", 500);

  const excludedIds = ((lists ?? []) as unknown as Array<{ id: string; is_archive: boolean; slug: string }>)
    .filter((l) => l.is_archive || l.slug === "migration-qc")
    .map((l) => l.id);

  let totalQuery = db.from("leads").select("*", { count: "exact", head: true }).is("deleted_at", null);
  let assignedQuery = db
    .from("leads")
    .select("*", { count: "exact", head: true })
    .is("deleted_at", null)
    .not("assigned_to", "is", null);

  if (excludedIds.length > 0) {
    const excludedList = `(${excludedIds.join(",")})`;
    totalQuery = totalQuery.not("list_id", "in", excludedList);
    assignedQuery = assignedQuery.not("list_id", "in", excludedList);
  }

  const [{ count: total, error: totalError }, { count: assigned, error: assignedError }] = await Promise.all([
    totalQuery,
    assignedQuery,
  ]);

  if (totalError || assignedError) return apiError("DB_ERROR", "Failed to load coverage", 500);

  return apiSuccess({
    total: total ?? 0,
    assigned: assigned ?? 0,
    unassigned: (total ?? 0) - (assigned ?? 0),
    coveragePct: total ? Math.round(((assigned ?? 0) / total) * 100) : 0,
  });
}
