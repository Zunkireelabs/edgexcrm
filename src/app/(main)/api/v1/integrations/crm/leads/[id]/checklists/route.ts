import { NextRequest } from "next/server";
import { gateIntegrationRequest, withIntegrationErrorBoundary } from "@/lib/api/integration-helpers";
import { apiSuccess, apiNotFound, apiServiceUnavailable } from "@/lib/api/response";
import { requirePermission } from "@/lib/api/integration-permissions";

// GET /api/v1/integrations/crm/leads/:id/checklists
export const GET = withIntegrationErrorBoundary(async function GET(
  request: NextRequest,
  context?: unknown
) {
  const { params } = context as { params: Promise<{ id: string }> };
  const { id } = await params;
  const gate = await gateIntegrationRequest(request);
  if (!gate.ok) return gate.response;
  const { ctx } = gate;

  const denied = requirePermission(ctx.auth, "read");
  if (denied) return denied;

  // Verify lead exists and belongs to tenant
  const { data: lead } = await ctx.supabase
    .from("leads")
    .select("id")
    .eq("id", id)
    .eq("tenant_id", ctx.auth.tenantId)
    .is("deleted_at", null)
    .single();

  if (!lead) {
    return apiNotFound("Lead");
  }

  const { data, error } = await ctx.supabase
    .from("lead_checklists")
    .select("id, title, is_completed, completed_at, completed_by, position, created_at")
    .eq("lead_id", id)
    .order("position", { ascending: true });

  if (error) {
    return apiServiceUnavailable("Failed to fetch checklists");
  }

  return apiSuccess(data);
});
