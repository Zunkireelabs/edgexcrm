import { NextRequest } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { authenticateRequest, getClientIp } from "@/lib/api/auth";
import { apiSuccess, apiUnauthorized, apiForbidden, apiNotFound, apiServiceUnavailable } from "@/lib/api/response";
import { createRequestLogger } from "@/lib/logger";
import { createAuditLog } from "@/lib/api/audit";

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; userId: string }> },
) {
  const { id, userId } = await params;
  const requestId = crypto.randomUUID();
  const ip = getClientIp(request);
  const userAgent = request.headers.get("user-agent") || null;
  const log = createRequestLogger({
    requestId,
    method: "DELETE",
    path: `/api/v1/leads/${id}/collaborators/${userId}`,
    ip,
  });

  const auth = await authenticateRequest();
  if (!auth) return apiUnauthorized();
  if (auth.permissions.baseTier !== "owner" && auth.permissions.baseTier !== "admin") {
    return apiForbidden();
  }

  const supabase = await createServiceClient();

  const { data: lead } = await supabase
    .from("leads")
    .select("id")
    .eq("id", id)
    .eq("tenant_id", auth.tenantId)
    .is("deleted_at", null)
    .single();
  if (!lead) return apiNotFound("Lead");

  const { data: existing } = await supabase
    .from("lead_collaborators")
    .select("user_id")
    .eq("tenant_id", auth.tenantId)
    .eq("lead_id", id)
    .eq("user_id", userId)
    .maybeSingle();
  if (!existing) return apiNotFound("Collaborator");

  const { error } = await supabase
    .from("lead_collaborators")
    .delete()
    .eq("tenant_id", auth.tenantId)
    .eq("lead_id", id)
    .eq("user_id", userId);

  if (error) {
    log.error({ err: error }, "Failed to remove collaborator");
    return apiServiceUnavailable("Failed to remove collaborator");
  }

  log.info({ leadId: id, removedUserId: userId }, "Collaborator removed");

  void createAuditLog({
    tenantId: auth.tenantId,
    userId: auth.userId,
    action: "lead.collaborator_removed",
    entityType: "lead",
    entityId: id,
    changes: { collaborator: { old: userId, new: null } },
    ipAddress: ip,
    userAgent,
    requestId,
  });

  return apiSuccess({ removed: userId });
}
