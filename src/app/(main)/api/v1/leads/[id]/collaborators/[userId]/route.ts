import { NextRequest } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { authenticateRequest, getClientIp } from "@/lib/api/auth";
import { apiSuccess, apiUnauthorized, apiForbidden, apiNotFound, apiServiceUnavailable } from "@/lib/api/response";
import { createRequestLogger } from "@/lib/logger";
import { createAuditLog } from "@/lib/api/audit";
import { touchLeadUpdatedAt } from "@/lib/leads/touch-updated-at";
import { getLeadMembership } from "@/lib/leads/branch-membership";
import { canManageLeadCollaborators } from "@/lib/leads/collaborator-access";

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
  const isOwnerOrAdmin = auth.permissions.baseTier === "owner" || auth.permissions.baseTier === "admin";
  const isSelf = userId === auth.userId;
  // Owner/admin, the collaborator removing themselves, or a branch manager (team scope) for a lead in their own branch (checked below).
  if (!isOwnerOrAdmin && !isSelf && auth.permissions.leadScope !== "team") {
    return apiForbidden();
  }

  const supabase = await createServiceClient();

  const { data: lead } = await supabase
    .from("leads")
    .select("id, assigned_to, branch_id")
    .eq("id", id)
    .eq("tenant_id", auth.tenantId)
    .is("deleted_at", null)
    .single();
  if (!lead) return apiNotFound("Lead");

  if (!isOwnerOrAdmin && !isSelf) {
    const leadMembership = await getLeadMembership(supabase, auth.tenantId, id);
    if (!canManageLeadCollaborators(auth, lead as unknown as { assigned_to: string | null; branch_id: string | null }, leadMembership)) return apiForbidden();
  }

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

  // Keep "Updated At" reflecting real activity, not just direct field edits.
  void touchLeadUpdatedAt(supabase, auth.tenantId, id);

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
