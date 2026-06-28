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
import { createAuditLog } from "@/lib/api/audit";
import { createRequestLogger } from "@/lib/logger";

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * POST /api/v1/leads/bulk/restore
 * Restore soft-deleted leads (clears deleted_at) — the recycle-bin "Restore"
 * action. Admin-only, mirroring bulk delete. The lead returns to whatever list
 * it was in before deletion (its list_id was never changed by the soft delete).
 */
export async function POST(request: NextRequest) {
  const requestId = crypto.randomUUID();
  const ip = getClientIp(request);
  const userAgent = request.headers.get("user-agent") || null;
  const log = createRequestLogger({
    requestId,
    method: "POST",
    path: "/api/v1/leads/bulk/restore",
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
    return apiValidationError({ ids: ["Cannot restore more than 100 leads at once"] });
  }
  if (body.ids.some((id) => !UUID_REGEX.test(id))) {
    return apiValidationError({ ids: ["Invalid UUID format in IDs"] });
  }

  const supabase = await createServiceClient();

  // Only restore leads that belong to this tenant AND are currently soft-deleted.
  const { data: existingLeads, error: fetchError } = await supabase
    .from("leads")
    .select("id")
    .eq("tenant_id", auth.tenantId)
    .not("deleted_at", "is", null)
    .in("id", body.ids);

  if (fetchError) {
    log.error({ err: fetchError }, "Failed to fetch leads for bulk restore");
    return apiServiceUnavailable("Failed to verify leads");
  }

  const idsToRestore = (existingLeads ?? []).map((l) => l.id);
  if (idsToRestore.length === 0) {
    return apiValidationError({ ids: ["No deleted leads found to restore"] });
  }

  const { error: restoreError } = await supabase
    .from("leads")
    .update({ deleted_at: null })
    .eq("tenant_id", auth.tenantId)
    .in("id", idsToRestore);

  if (restoreError) {
    log.error({ err: restoreError }, "Failed to bulk restore leads");
    return apiServiceUnavailable("Failed to restore leads");
  }

  log.info({ count: idsToRestore.length, ids: idsToRestore }, "Bulk restored leads");

  Promise.all(
    idsToRestore.map((id) =>
      createAuditLog({
        tenantId: auth.tenantId,
        userId: auth.userId,
        action: "lead.restored",
        entityType: "lead",
        entityId: id,
        ipAddress: ip,
        userAgent,
        requestId,
      }),
    ),
  ).catch((err) => log.error({ err }, "Failed to write restore audit logs"));

  return apiSuccess({ restored: idsToRestore.length });
}
