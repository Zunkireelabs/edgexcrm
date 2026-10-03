import { NextRequest } from "next/server";
import { authenticateRequest } from "@/lib/api/auth";
import { apiUnauthorized, apiForbidden, apiNotFound, apiError } from "@/lib/api/response";
import { scopedClient } from "@/lib/supabase/scoped";
import { getFeatureAccess } from "@/industries/_loader";
import { FEATURES } from "@/industries/_registry";
import { skippedItemsToCsv } from "@/industries/_shared/features/outreach/lib/bulk-enroll";

type Props = { params: Promise<{ id: string }> };

const PAGE = 1000;

// GET /api/v1/outreach/bulk-enroll/[id]/skipped — CSV (lead_id, reason) of every lead that was skipped or failed.
export async function GET(_request: NextRequest, { params }: Props) {
  const { id } = await params;
  const auth = await authenticateRequest();
  if (!auth) return apiUnauthorized();
  if (!getFeatureAccess(auth.industryId, FEATURES.OUTREACH)) return apiForbidden();

  const db = await scopedClient(auth);
  const { data } = await db.from("sequence_bulk_enrollments").select("id, created_by").eq("id", id).maybeSingle();
  const run = data as unknown as { created_by: string | null } | null;
  if (!run) return apiNotFound("Bulk enrollment");

  const isAdminTier = auth.role === "owner" || auth.role === "admin";
  if (!isAdminTier && run.created_by !== auth.userId) return apiNotFound("Bulk enrollment");

  const rows: { lead_id: string; outcome: string; reason: string | null }[] = [];
  for (let from = 0; ; from += PAGE) {
    const { data: page, error } = await db
      .from("sequence_bulk_enrollment_items")
      .select("lead_id, outcome, reason")
      .eq("run_id", id)
      .in("outcome", ["skipped", "failed"])
      .order("created_at", { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) return apiError("DB_ERROR", "Failed to load the skipped leads", 500);
    const batch = (page ?? []) as unknown as { lead_id: string; outcome: string; reason: string | null }[];
    rows.push(...batch);
    if (batch.length < PAGE) break;
  }

  return new Response(skippedItemsToCsv(rows), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="bulk-enroll-${id}-skipped.csv"`,
    },
  });
}
