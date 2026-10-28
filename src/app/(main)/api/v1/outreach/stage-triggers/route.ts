import { NextRequest } from "next/server";
import { authenticateRequest, requireAdmin } from "@/lib/api/auth";
import { apiSuccess, apiUnauthorized, apiForbidden, apiError, apiValidationError } from "@/lib/api/response";
import { scopedClient } from "@/lib/supabase/scoped";
import { getFeatureAccess } from "@/industries/_loader";
import { FEATURES } from "@/industries/_registry";
import { countLeadsInStages, listActiveStageRules, parseStageIds } from "@/industries/_shared/features/outreach/lib/stage-rules";

// GET /api/v1/outreach/stage-triggers — every active stage auto-enroll rule in the tenant (migration 277), so the sequence editor
// can say "Qualified already auto-enrolls into X" before the admin saves.
//   ?count_list_ids=a,b  also returns how many leads sit in those stages now ("Also enroll the N leads already in…") — admins only,
//                        because only they can act on it.
// Read-only; changing rules happens per sequence (PUT /sequences/[id]/stage-triggers).

export async function GET(request: NextRequest) {
  const auth = await authenticateRequest();
  if (!auth) return apiUnauthorized();
  if (!getFeatureAccess(auth.industryId, FEATURES.OUTREACH)) return apiForbidden();

  const db = await scopedClient(auth);
  try {
    const rules = await listActiveStageRules(db);

    const param = new URL(request.url).searchParams.get("count_list_ids");
    let leadsInStages: number | null = null;
    if (param !== null && requireAdmin(auth)) {
      const parsed = parseStageIds(param === "" ? [] : param.split(","));
      if (!parsed.ok) return apiValidationError({ count_list_ids: [parsed.error] });
      leadsInStages = await countLeadsInStages(db, parsed.listIds);
    }
    return apiSuccess({ rules, leads_in_stages: leadsInStages });
  } catch {
    return apiError("DB_ERROR", "Failed to load the auto-enroll rules", 500);
  }
}
