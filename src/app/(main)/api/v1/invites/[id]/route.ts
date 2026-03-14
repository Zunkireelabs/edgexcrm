import { NextRequest } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { authenticateRequest, requireAdmin, getClientIp } from "@/lib/api/auth";
import {
  apiSuccess,
  apiUnauthorized,
  apiForbidden,
  apiNotFound,
  apiServiceUnavailable,
} from "@/lib/api/response";
import { createAuditLog } from "@/lib/api/audit";
import { createRequestLogger } from "@/lib/logger";

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const requestId = crypto.randomUUID();
  const ip = getClientIp(request);
  const userAgent = request.headers.get("user-agent") || null;
  const log = createRequestLogger({
    requestId,
    method: "DELETE",
    path: `/api/v1/invites/${id}`,
    ip,
  });

  const auth = await authenticateRequest();
  if (!auth) return apiUnauthorized();
  if (!requireAdmin(auth)) return apiForbidden();

  const supabase = await createServiceClient();

  // Verify invite exists and belongs to tenant
  const { data: invite } = await supabase
    .from("invite_tokens")
    .select("id, email, role")
    .eq("id", id)
    .eq("tenant_id", auth.tenantId)
    .single();

  if (!invite) {
    return apiNotFound("Invite");
  }

  // Hard delete
  const { error } = await supabase
    .from("invite_tokens")
    .delete()
    .eq("id", id)
    .eq("tenant_id", auth.tenantId);

  if (error) {
    log.error({ err: error }, "Failed to delete invite");
    return apiServiceUnavailable("Failed to delete invite");
  }

  log.info({ inviteId: id }, "Invite deleted");

  createAuditLog({
    tenantId: auth.tenantId,
    userId: auth.userId,
    action: "invite.deleted",
    entityType: "invite",
    entityId: id,
    changes: {
      email: { old: invite.email, new: null },
      role: { old: invite.role, new: null },
    },
    ipAddress: ip,
    userAgent,
    requestId,
  });

  return apiSuccess({ id, deleted: true });
}
