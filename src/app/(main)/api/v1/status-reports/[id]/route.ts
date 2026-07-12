import { NextRequest } from "next/server";
import { authenticateRequest, requireAdmin } from "@/lib/api/auth";
import {
  apiSuccess,
  apiUnauthorized,
  apiForbidden,
  apiNotFound,
  apiError,
  apiConflict,
} from "@/lib/api/response";
import { createRequestLogger } from "@/lib/logger";
import { scopedClient } from "@/lib/supabase/scoped";
import { getFeatureAccess } from "@/industries/_loader";
import { FEATURES } from "@/industries/_registry";
import { createAuditLog } from "@/lib/api/audit";

interface Props {
  params: Promise<{ id: string }>;
}

export async function PATCH(request: NextRequest, { params }: Props) {
  const { id } = await params;
  const requestId = crypto.randomUUID();
  const log = createRequestLogger({ requestId, method: "PATCH", path: `/api/v1/status-reports/${id}` });

  const auth = await authenticateRequest();
  if (!auth) return apiUnauthorized();
  if (!getFeatureAccess(auth.industryId, FEATURES.PROJECT_BOARD)) return apiForbidden();
  if (!requireAdmin(auth)) return apiForbidden();

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return apiError("INVALID_JSON", "Request body must be valid JSON", 400);
  }

  const db = await scopedClient(auth);
  const { data: existing } = await db
    .from("project_status_reports")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (!existing) return apiNotFound("Status report");
  const existingRow = existing as unknown as Record<string, unknown>;

  const enabling = body.is_client_visible === true;
  if (enabling && !existingRow.published_at) {
    return apiConflict("Only a published report can be shared");
  }

  const patch: Record<string, unknown> = {};
  if (body.is_client_visible !== undefined) {
    patch.is_client_visible = Boolean(body.is_client_visible);
    if (patch.is_client_visible && !existingRow.public_token) {
      patch.public_token = crypto.randomUUID();
    }
  }
  if (body.regenerate_token === true) {
    patch.public_token = crypto.randomUUID();
  }

  const { data: updated, error } = await db
    .from("project_status_reports")
    .update(patch)
    .eq("id", id)
    .select()
    .single();

  if (error) {
    log.error({ error }, "Failed to update status report");
    return apiError("DB_ERROR", "Failed to update status report", 500);
  }

  // Never log the raw token — treat it like a secret. Record only whether it changed.
  const redactToken = (row: Record<string, unknown>) =>
    "public_token" in row ? { ...row, public_token: row.public_token ? "[redacted]" : null } : row;
  const auditOld = redactToken(existingRow);
  const auditNew = redactToken(patch);
  if (body.regenerate_token === true) auditNew.token_regenerated = true;

  await createAuditLog({
    tenantId: auth.tenantId,
    userId: auth.userId,
    action: "status_report.updated",
    entityType: "status_report",
    entityId: id,
    changes: { patch: { old: auditOld, new: auditNew } },
    requestId,
  });

  log.info({ statusReportId: id }, "Status report updated");
  return apiSuccess(updated);
}
