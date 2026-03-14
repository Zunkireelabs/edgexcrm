import { authenticateRequest, requireAdmin } from "@/lib/api/auth";
import { createServiceClient } from "@/lib/supabase/server";
import { createAuditLog } from "@/lib/api/audit";
import {
  apiUnauthorized,
  apiForbidden,
  apiNotFound,
  apiError,
  apiInternalError,
} from "@/lib/api/response";
import { logger } from "@/lib/logger";

/**
 * DELETE /api/v1/settings/api-keys/[id]
 * Soft-revoke an integration key by setting revoked_at = now().
 * Immediately invalidates the key (auth middleware checks revoked_at IS NULL).
 */
export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await authenticateRequest();
  if (!auth) return apiUnauthorized();
  if (!requireAdmin(auth)) return apiForbidden();

  const { id } = await params;

  if (!id || !/^[0-9a-f-]{36}$/i.test(id)) {
    return apiNotFound("API key");
  }

  try {
    const supabase = await createServiceClient();

    // Verify key belongs to this tenant and is not already revoked
    const { data: existing, error: fetchError } = await supabase
      .from("integration_keys")
      .select("id, name, revoked_at")
      .eq("id", id)
      .eq("tenant_id", auth.tenantId)
      .single();

    if (fetchError || !existing) {
      return apiNotFound("API key");
    }

    if (existing.revoked_at) {
      return apiError("ALREADY_REVOKED", "This API key is already revoked", 409);
    }

    // Soft revoke
    const { error: updateError } = await supabase
      .from("integration_keys")
      .update({ revoked_at: new Date().toISOString() })
      .eq("id", id);

    if (updateError) {
      logger.error({ err: updateError }, "Failed to revoke integration key");
      return apiInternalError();
    }

    // Audit log
    await createAuditLog({
      tenantId: auth.tenantId,
      userId: auth.userId,
      action: "integration_key.revoked",
      entityType: "integration_key",
      entityId: id,
      changes: { name: { old: existing.name, new: null } },
    });

    return new Response(null, { status: 204 });
  } catch (err) {
    logger.error({ err }, "Error revoking integration key");
    return apiInternalError();
  }
}
