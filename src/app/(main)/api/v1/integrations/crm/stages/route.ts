import { NextRequest } from "next/server";
import {
  gateIntegrationRequest,
  normalizeStage,
  withIntegrationErrorBoundary,
} from "@/lib/api/integration-helpers";
import { apiSuccess, apiServiceUnavailable } from "@/lib/api/response";
import { requirePermission } from "@/lib/api/integration-permissions";
import type { PipelineStage } from "@/types/database";

// GET /api/v1/integrations/crm/stages
export const GET = withIntegrationErrorBoundary(async function GET(request: NextRequest) {
  const gate = await gateIntegrationRequest(request);
  if (!gate.ok) return gate.response;
  const { ctx } = gate;

  const denied = requirePermission(ctx.auth, "read");
  if (denied) return denied;

  const { data, error } = await ctx.supabase
    .from("pipeline_stages")
    .select("*")
    .eq("tenant_id", ctx.auth.tenantId)
    .order("position", { ascending: true });

  if (error) {
    return apiServiceUnavailable("Failed to fetch stages");
  }

  return apiSuccess((data as PipelineStage[]).map(normalizeStage));
});
