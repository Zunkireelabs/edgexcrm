import { NextRequest } from "next/server";
import { authenticateRequest, requireAdmin } from "@/lib/api/auth";
import {
  apiSuccess,
  apiUnauthorized,
  apiForbidden,
  apiError,
} from "@/lib/api/response";
import { createRequestLogger } from "@/lib/logger";
import { scopedClient } from "@/lib/supabase/scoped";
import { getFeatureAccess } from "@/industries/_loader";
import { FEATURES } from "@/industries/_registry";
import { createAuditLog } from "@/lib/api/audit";

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export async function GET(_request: NextRequest) {
  const auth = await authenticateRequest();
  if (!auth) return apiUnauthorized();
  if (!getFeatureAccess(auth.industryId, FEATURES.APPLICATION_TRACKING)) return apiForbidden();

  const db = await scopedClient(auth);
  const { data, error } = await db
    .from("consent_templates")
    .select("*")
    .maybeSingle();

  if (error) return apiError("DB_ERROR", "Failed to fetch consent template", 500);
  return apiSuccess(data ?? null);
}

export async function PUT(request: NextRequest) {
  const requestId = crypto.randomUUID();
  const log = createRequestLogger({ requestId, method: "PUT", path: "/api/v1/consent-template" });

  const auth = await authenticateRequest();
  if (!auth) return apiUnauthorized();
  if (!getFeatureAccess(auth.industryId, FEATURES.APPLICATION_TRACKING)) return apiForbidden();
  if (!requireAdmin(auth)) return apiForbidden();

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return apiError("INVALID_JSON", "Request body must be valid JSON", 400);
  }

  const db = await scopedClient(auth);

  // Check if a template exists already
  const { data: existing } = await db
    .from("consent_templates")
    .select("id, version")
    .maybeSingle();

  const existingRow = existing as { id: string; version: number } | null;

  const patch: Record<string, unknown> = {};
  if (body.title !== undefined) patch.title = String(body.title).trim();
  if (body.body !== undefined) patch.body = String(body.body);
  if (body.require_drawn_signature !== undefined) patch.require_drawn_signature = Boolean(body.require_drawn_signature);
  if (body.link_expiry_days !== undefined) patch.link_expiry_days = Math.max(1, Number(body.link_expiry_days));
  if (body.is_active !== undefined) patch.is_active = Boolean(body.is_active);

  let result;
  if (existingRow) {
    // Update and bump version
    patch.version = existingRow.version + 1;
    result = await db
      .from("consent_templates")
      .update(patch)
      .eq("id", existingRow.id)
      .select()
      .single();
  } else {
    // Insert first-time row
    patch.tenant_id = auth.tenantId;
    result = await db
      .from("consent_templates")
      .insert(patch)
      .select()
      .single();
  }

  if (result.error) {
    log.error({ error: result.error }, "Failed to upsert consent template");
    return apiError("DB_ERROR", "Failed to save consent template", 500);
  }

  const row = result.data as { id: string };

  await createAuditLog({
    tenantId: auth.tenantId,
    userId: auth.userId,
    action: "consent_template.updated",
    entityType: "consent_template",
    entityId: row.id,
    requestId,
  });

  log.info({ templateId: row.id }, "Consent template saved");
  return apiSuccess(result.data, existingRow ? 200 : 201);
}
