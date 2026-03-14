import { NextRequest } from "next/server";
import {
  gateIntegrationRequest,
  buildLookupMaps,
  normalizeLead,
  normalizeStage,
  withIntegrationErrorBoundary,
} from "@/lib/api/integration-helpers";
import { apiSuccess, apiServiceUnavailable } from "@/lib/api/response";
import { requirePermission } from "@/lib/api/integration-permissions";
import type { Lead, PipelineStage } from "@/types/database";

// GET /api/v1/integrations/crm/pipeline
export const GET = withIntegrationErrorBoundary(async function GET(request: NextRequest) {
  const gate = await gateIntegrationRequest(request);
  if (!gate.ok) return gate.response;
  const { ctx } = gate;

  const denied = requirePermission(ctx.auth, "read");
  if (denied) return denied;

  const tenantId = ctx.auth.tenantId;

  const [stagesResult, leadsResult] = await Promise.all([
    ctx.supabase
      .from("pipeline_stages")
      .select("*")
      .eq("tenant_id", tenantId)
      .order("position", { ascending: true }),
    ctx.supabase
      .from("leads")
      .select("*")
      .eq("tenant_id", tenantId)
      .is("deleted_at", null)
      .not("stage_id", "is", null)
      .order("created_at", { ascending: false }),
  ]);

  if (stagesResult.error || leadsResult.error) {
    return apiServiceUnavailable("Failed to fetch pipeline");
  }

  const stages = stagesResult.data as PipelineStage[];
  const leads = leadsResult.data as Lead[];

  const { stageMap, userMap } = await buildLookupMaps(ctx.supabase, tenantId);

  // Group leads by stage
  const leadsByStage = new Map<string, Lead[]>();
  for (const lead of leads) {
    if (!lead.stage_id) continue;
    const group = leadsByStage.get(lead.stage_id) || [];
    group.push(lead);
    leadsByStage.set(lead.stage_id, group);
  }

  const pipeline = stages.map((stage) => ({
    stage: normalizeStage(stage),
    leads: (leadsByStage.get(stage.id) || []).map((lead) =>
      normalizeLead(lead, stageMap, userMap)
    ),
  }));

  return apiSuccess(pipeline);
});
