import { NextRequest } from "next/server";
import { authenticateRequest } from "@/lib/api/auth";
import { apiSuccess, apiPaginated, apiUnauthorized, apiForbidden, apiError } from "@/lib/api/response";
import { scopedClient } from "@/lib/supabase/scoped";
import { getFeatureAccess } from "@/industries/_loader";
import { FEATURES } from "@/industries/_registry";
import { buildDraftsQuery, cleanUuid } from "@/industries/_shared/features/outreach/lib/draft-scope";

const MAX_PAGE_SIZE = 100;

// GET /api/v1/outreach/drafts?due=today|all&assigned_to=<uuid>&lead_id=<uuid>[&page=1&pageSize=50]
//
// With `page` the answer is one PAGE (default 50, max 100) plus meta.total — the Today list uses this, so it stays fast
// and honest with thousands of drafts. Without `page` it returns every match in one go (the old shape); PostgREST caps
// that at 1,000 rows, so new callers should page or narrow with lead_id.
export async function GET(request: NextRequest) {
  const auth = await authenticateRequest();
  if (!auth) return apiUnauthorized();
  if (!getFeatureAccess(auth.industryId, FEATURES.OUTREACH)) return apiForbidden();

  const db = await scopedClient(auth);
  const { searchParams } = new URL(request.url);
  const due = searchParams.get("due") === "today" ? "today" : "all";
  const filters = {
    due,
    assignedTo: cleanUuid(searchParams.get("assigned_to")),
    leadId: cleanUuid(searchParams.get("lead_id")),
  } as const;

  const pageParam = searchParams.get("page");
  if (pageParam !== null) {
    const page = Math.max(1, parseInt(pageParam, 10) || 1);
    const pageSize = Math.min(MAX_PAGE_SIZE, Math.max(1, parseInt(searchParams.get("pageSize") || "50", 10) || 50));
    const from = (page - 1) * pageSize;

    // due_at then id: a stable order, so a draft never appears on two pages (or none) while paging
    const { data, error, count } = await buildDraftsQuery(db, auth, filters, undefined, { count: "exact" })
      .order("due_at", { ascending: true })
      .order("id", { ascending: true })
      .range(from, from + pageSize - 1);
    if (error) return apiError("DB_ERROR", "Failed to fetch drafts", 500);
    const total = count ?? 0;
    return apiPaginated(data ?? [], { page, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)) });
  }

  const { data, error } = await buildDraftsQuery(db, auth, filters).order("due_at", { ascending: true });
  if (error) return apiError("DB_ERROR", "Failed to fetch drafts", 500);
  return apiSuccess(data ?? []);
}
