import { NextRequest } from "next/server";
import { authenticateRequest, requireAdmin } from "@/lib/api/auth";
import {
  apiSuccess,
  apiUnauthorized,
  apiForbidden,
  apiNotFound,
  apiError,
  apiValidationError,
} from "@/lib/api/response";
import { validate, required, maxLength, optionalMaxLength, isUUID, isIn } from "@/lib/api/validation";
import { createRequestLogger } from "@/lib/logger";
import { scopedClient } from "@/lib/supabase/scoped";
import { getFeatureAccess } from "@/industries/_loader";
import { FEATURES } from "@/industries/_registry";
import { createAuditLog, emitEvent } from "@/lib/api/audit";

const PROJECT_STATUSES = ["planning", "active", "on_hold", "done", "cancelled"];

export async function GET(request: NextRequest) {
  const auth = await authenticateRequest();
  if (!auth) return apiUnauthorized();
  if (!getFeatureAccess(auth.industryId, FEATURES.ACCOUNTS)) return apiForbidden();

  const db = await scopedClient(auth);
  const { searchParams } = new URL(request.url);
  const accountId = searchParams.get("account_id");
  const statusFilter = searchParams.get("status");

  let query = db.from("projects").select("*");
  if (accountId) query = query.eq("account_id", accountId);
  if (statusFilter) query = query.eq("status", statusFilter);
  const { data: projects, error } = await query.order("created_at", { ascending: false });

  if (error) return apiError("DB_ERROR", "Failed to fetch projects", 500);
  return apiSuccess(projects ?? []);
}

export async function POST(request: NextRequest) {
  const requestId = crypto.randomUUID();
  const log = createRequestLogger({ requestId, method: "POST", path: "/api/v1/projects" });

  const auth = await authenticateRequest();
  if (!auth) return apiUnauthorized();
  if (!getFeatureAccess(auth.industryId, FEATURES.ACCOUNTS)) return apiForbidden();
  if (!requireAdmin(auth)) return apiForbidden();

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return apiError("INVALID_JSON", "Request body must be valid JSON", 400);
  }

  const { valid, errors } = validate(body, {
    name: [required("name"), maxLength(255)],
    account_id: [required("account_id"), isUUID()],
    status: [isIn(PROJECT_STATUSES)],
    notes: [optionalMaxLength(2000)],
  });
  if (!valid) return apiValidationError(errors);

  const db = await scopedClient(auth);

  // Verify account belongs to this tenant
  const { data: account } = await db
    .from("accounts")
    .select("id")
    .eq("id", String(body.account_id))
    .maybeSingle();
  if (!account) return apiNotFound("Account");

  const { data: created, error } = await db
    .from("projects")
    .insert({
      account_id: String(body.account_id),
      name: String(body.name).trim(),
      status: body.status ? String(body.status) : "active",
      default_rate:
        body.default_rate != null ? Number(body.default_rate) : null,
      is_billable: body.is_billable !== false,
      notes: body.notes ? String(body.notes).trim() : null,
    })
    .select()
    .single();

  if (error) {
    log.error({ error }, "Failed to create project");
    return apiError("DB_ERROR", "Failed to create project", 500);
  }

  await Promise.all([
    createAuditLog({
      tenantId: auth.tenantId,
      userId: auth.userId,
      action: "project.created",
      entityType: "project",
      entityId: created.id,
      requestId,
    }),
    emitEvent({
      tenantId: auth.tenantId,
      type: "project.created",
      entityType: "project",
      entityId: created.id,
      requestId,
    }),
  ]);

  log.info({ projectId: created.id }, "Project created");
  return apiSuccess(created, 201);
}
