import { NextRequest } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { authenticateRequest, requireAdmin, getClientIp } from "@/lib/api/auth";
import {
  apiSuccess,
  apiValidationError,
  apiUnauthorized,
  apiForbidden,
  apiServiceUnavailable,
} from "@/lib/api/response";
import { createAuditLog, emitEvent } from "@/lib/api/audit";
import { createRequestLogger } from "@/lib/logger";

export async function DELETE(request: NextRequest) {
  const requestId = crypto.randomUUID();
  const ip = getClientIp(request);
  const userAgent = request.headers.get("user-agent") || null;
  const log = createRequestLogger({
    requestId,
    method: "DELETE",
    path: "/api/v1/leads/bulk",
    ip,
  });

  const auth = await authenticateRequest();
  if (!auth) return apiUnauthorized();
  if (!requireAdmin(auth)) return apiForbidden();

  let body: { ids?: string[] };
  try {
    body = await request.json();
  } catch {
    return apiValidationError({ body: ["Invalid JSON body"] });
  }

  if (!body.ids || !Array.isArray(body.ids) || body.ids.length === 0) {
    return apiValidationError({ ids: ["Must provide an array of lead IDs"] });
  }

  if (body.ids.length > 100) {
    return apiValidationError({ ids: ["Cannot delete more than 100 leads at once"] });
  }

  // Validate all IDs are valid UUIDs
  const uuidRegex = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
  const invalidIds = body.ids.filter((id) => !uuidRegex.test(id));
  if (invalidIds.length > 0) {
    return apiValidationError({ ids: ["Invalid UUID format in IDs"] });
  }

  const supabase = await createServiceClient();

  // Verify all leads exist and belong to tenant
  const { data: existingLeads, error: fetchError } = await supabase
    .from("leads")
    .select("id")
    .eq("tenant_id", auth.tenantId)
    .is("deleted_at", null)
    .in("id", body.ids);

  if (fetchError) {
    log.error({ err: fetchError }, "Failed to fetch leads for bulk delete");
    return apiServiceUnavailable("Failed to verify leads");
  }

  const existingIds = new Set(existingLeads?.map((l) => l.id) || []);
  const notFoundIds = body.ids.filter((id) => !existingIds.has(id));

  if (notFoundIds.length > 0) {
    log.info({ notFoundIds }, "Some leads not found for bulk delete");
  }

  // Only delete leads that exist
  const idsToDelete = body.ids.filter((id) => existingIds.has(id));

  if (idsToDelete.length === 0) {
    return apiValidationError({ ids: ["No valid leads found to delete"] });
  }

  // Soft delete all leads
  const { error: deleteError } = await supabase
    .from("leads")
    .update({ deleted_at: new Date().toISOString() })
    .eq("tenant_id", auth.tenantId)
    .in("id", idsToDelete);

  if (deleteError) {
    log.error({ err: deleteError }, "Failed to bulk soft delete leads");
    return apiServiceUnavailable("Failed to delete leads");
  }

  log.info({ count: idsToDelete.length, ids: idsToDelete }, "Bulk soft deleted leads");

  // Create audit logs and events for each deleted lead
  Promise.all(
    idsToDelete.flatMap((id) => [
      createAuditLog({
        tenantId: auth.tenantId,
        userId: auth.userId,
        action: "lead.deleted",
        entityType: "lead",
        entityId: id,
        ipAddress: ip,
        userAgent,
        requestId,
      }),
      emitEvent({
        tenantId: auth.tenantId,
        type: "lead.deleted",
        entityType: "lead",
        entityId: id,
        requestId,
      }),
    ])
  );

  return apiSuccess({
    deleted: idsToDelete.length,
    ids: idsToDelete,
    notFound: notFoundIds,
  });
}
