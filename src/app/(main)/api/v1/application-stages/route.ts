import { NextRequest } from "next/server";
import { authenticateRequest } from "@/lib/api/auth";
import { apiSuccess, apiUnauthorized, apiForbidden, apiError } from "@/lib/api/response";
import { scopedClient } from "@/lib/supabase/scoped";
import { createServiceClient } from "@/lib/supabase/server";
import { getFeatureAccess } from "@/industries/_loader";
import { FEATURES } from "@/industries/_registry";
import { resolveApplicationPipelineAndStage } from "@/lib/applications/pipeline-resolution";

/**
 * Application stages.
 *
 * Without a query string this returns EVERY stage of every country pipeline (unchanged — the board and
 * the application rows use it to look stages up by id).
 *
 * `?country=<name>` returns only the stages of the pipeline that country maps to, falling back to the
 * default pipeline (an empty name means "no destination chosen yet"). It uses the SAME resolver that
 * picks the pipeline when an application is saved, so the list an Add Application form shows can never
 * disagree with what gets stored. Without this the Status dropdown listed each stage name once per
 * country pipeline, and a status from another country's pipeline was silently replaced on save.
 */
export async function GET(request: NextRequest) {
  const auth = await authenticateRequest();
  if (!auth) return apiUnauthorized();
  if (!getFeatureAccess(auth.industryId, FEATURES.APPLICATION_TRACKING)) return apiForbidden();

  const db = await scopedClient(auth);
  const country = request.nextUrl.searchParams.get("country");

  if (country !== null) {
    const supabase = await createServiceClient();
    const resolution = await resolveApplicationPipelineAndStage(supabase, {
      tenantId: auth.tenantId,
      countryName: country.trim(),
    });

    if (resolution.ok) {
      const { data, error } = await db
        .from("application_stages")
        .select("*")
        .eq("pipeline_id", resolution.pipelineId)
        .order("position", { ascending: true });

      if (error) return apiError("DB_ERROR", "Failed to fetch application stages", 500);
      return apiSuccess(data ?? []);
    }
    // No pipeline could be resolved (nothing matched and there is no default pipeline): fall through to the
    // full list rather than returning an empty one, so the form stays usable.
  }

  const { data, error } = await db
    .from("application_stages")
    .select("*")
    .order("position", { ascending: true });

  if (error) return apiError("DB_ERROR", "Failed to fetch application stages", 500);
  return apiSuccess(data ?? []);
}
