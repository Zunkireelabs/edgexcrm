import { NextRequest } from "next/server";
import { authenticateRequest } from "@/lib/api/auth";
import { apiSuccess, apiUnauthorized, apiForbidden, apiError } from "@/lib/api/response";
import { scopedClient } from "@/lib/supabase/scoped";
import { getFeatureAccess } from "@/industries/_loader";
import { FEATURES } from "@/industries/_registry";
import { ensureDealPipeline } from "@/lib/deals/stages";

export async function GET(request: NextRequest) {
  const auth = await authenticateRequest();
  if (!auth) return apiUnauthorized();
  if (!getFeatureAccess(auth.industryId, FEATURES.DEALS)) return apiForbidden();

  const db = await scopedClient(auth);
  const defaultPipelineId = await ensureDealPipeline(db, auth.tenantId);

  const { searchParams } = new URL(request.url);
  const pipelineId = searchParams.get("pipeline_id") || defaultPipelineId;

  const { data, error } = await db
    .from("deal_stages")
    .select("*")
    .eq("pipeline_id", pipelineId)
    .order("position", { ascending: true });

  if (error) return apiError("DB_ERROR", "Failed to fetch deal stages", 500);
  return apiSuccess(data ?? []);
}
