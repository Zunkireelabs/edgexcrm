import { NextRequest } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { authenticateRequest, requireAdmin, getClientIp } from "@/lib/api/auth";
import {
  apiSuccess,
  apiValidationError,
  apiUnauthorized,
  apiForbidden,
  apiNotFound,
  apiServiceUnavailable,
} from "@/lib/api/response";
import { validate, required, maxLength, isPositiveInt } from "@/lib/api/validation";
import { createAuditLog, emitEvent } from "@/lib/api/audit";
import { createRequestLogger } from "@/lib/logger";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const requestId = crypto.randomUUID();
  const log = createRequestLogger({
    requestId,
    method: "GET",
    path: `/api/v1/leads/${id}/checklists`,
  });

  const auth = await authenticateRequest();
  if (!auth) return apiUnauthorized();

  const supabase = await createServiceClient();

  // Verify lead exists, not soft-deleted, tenant scoped
  const { data: lead } = await supabase
    .from("leads")
    .select("id, assigned_to")
    .eq("id", id)
    .eq("tenant_id", auth.tenantId)
    .is("deleted_at", null)
    .single();

  if (!lead) return apiNotFound("Lead");

  // Counselor scoping
  if (auth.role === "counselor" && lead.assigned_to !== auth.userId) {
    return apiNotFound("Lead");
  }

  const { data, error } = await supabase
    .from("lead_checklists")
    .select("*")
    .eq("lead_id", id)
    .order("position", { ascending: true });

  if (error) {
    log.error({ err: error }, "Failed to fetch checklists");
    return apiServiceUnavailable("Failed to fetch checklists");
  }

  return apiSuccess(data);
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const requestId = crypto.randomUUID();
  const ip = getClientIp(request);
  const userAgent = request.headers.get("user-agent") || null;
  const log = createRequestLogger({
    requestId,
    method: "POST",
    path: `/api/v1/leads/${id}/checklists`,
    ip,
  });

  const auth = await authenticateRequest();
  if (!auth) return apiUnauthorized();
  if (!requireAdmin(auth)) return apiForbidden();

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return apiValidationError({ body: ["Invalid JSON body"] });
  }

  const { valid, errors } = validate(body, {
    title: [required("title"), maxLength(255)],
    ...(body.position !== undefined ? { position: [isPositiveInt()] } : {}),
  });
  if (!valid) return apiValidationError(errors);

  const supabase = await createServiceClient();

  // Verify lead exists, not soft-deleted, tenant scoped
  const { data: lead } = await supabase
    .from("leads")
    .select("id, assigned_to")
    .eq("id", id)
    .eq("tenant_id", auth.tenantId)
    .is("deleted_at", null)
    .single();

  if (!lead) return apiNotFound("Lead");

  const { data: checklist, error } = await supabase
    .from("lead_checklists")
    .insert({
      lead_id: id,
      tenant_id: auth.tenantId,
      title: body.title as string,
      position: body.position !== undefined ? Number(body.position) : 0,
    })
    .select()
    .single();

  if (error) {
    log.error({ err: error }, "Failed to create checklist item");
    return apiServiceUnavailable("Failed to create checklist item");
  }

  log.info({ checklistId: checklist.id, leadId: id }, "Checklist item created");

  Promise.all([
    createAuditLog({
      tenantId: auth.tenantId,
      userId: auth.userId,
      action: "checklist.created",
      entityType: "checklist",
      entityId: checklist.id,
      changes: { title: { old: null, new: body.title } },
      ipAddress: ip,
      userAgent,
      requestId,
    }),
    emitEvent({
      tenantId: auth.tenantId,
      type: "checklist.created",
      entityType: "checklist",
      entityId: checklist.id,
      payload: { lead_id: id, title: body.title },
      requestId,
    }),
  ]);

  return apiSuccess(checklist, 201);
}
