import { NextRequest } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { authenticateRequest, getClientIp } from "@/lib/api/auth";
import {
  apiSuccess,
  apiPaginated,
  apiValidationError,
  apiUnauthorized,
  apiNotFound,
  apiRateLimited,
  apiServiceUnavailable,
} from "@/lib/api/response";
import { validate, required, isUUID } from "@/lib/api/validation";
import { createAuditLog, emitEvent } from "@/lib/api/audit";
import { checkRateLimit, FORM_SUBMIT_LIMIT } from "@/lib/api/rate-limit";
import { createRequestLogger } from "@/lib/logger";
import type { Lead } from "@/types/database";

export async function GET(request: NextRequest) {
  const requestId = crypto.randomUUID();
  const log = createRequestLogger({
    requestId,
    method: "GET",
    path: "/api/v1/leads",
  });

  const auth = await authenticateRequest();
  if (!auth) return apiUnauthorized();

  log.info({ tenantId: auth.tenantId }, "Fetching leads");

  const searchParams = request.nextUrl.searchParams;
  const page = Math.max(1, parseInt(searchParams.get("page") || "1", 10));
  const pageSize = Math.min(
    100,
    Math.max(1, parseInt(searchParams.get("pageSize") || "20", 10))
  );
  const status = searchParams.get("status");
  const search = searchParams.get("search");
  let assignedTo = searchParams.get("assigned_to");

  const supabase = await createServiceClient();

  let query = supabase
    .from("leads")
    .select("*", { count: "exact" })
    .eq("tenant_id", auth.tenantId)
    .is("deleted_at", null);

  // Counselor scoping: force assigned_to filter
  if (auth.role === "counselor") {
    assignedTo = auth.userId;
  }

  if (assignedTo) {
    query = query.eq("assigned_to", assignedTo);
  }

  if (status) {
    query = query.eq("status", status);
  }

  if (search) {
    query = query.or(
      `first_name.ilike.%${search}%,last_name.ilike.%${search}%,email.ilike.%${search}%,phone.ilike.%${search}%`
    );
  }

  const from = (page - 1) * pageSize;
  const to = from + pageSize - 1;

  const { data, error, count } = await query
    .order("created_at", { ascending: false })
    .range(from, to);

  if (error) {
    log.error({ err: error }, "Failed to fetch leads");
    return apiServiceUnavailable("Failed to fetch leads");
  }

  const total = count || 0;
  log.info({ total, page, pageSize }, "Leads fetched");

  return apiPaginated(data as Lead[], {
    page,
    pageSize,
    total,
    totalPages: Math.ceil(total / pageSize),
  });
}

export async function POST(request: NextRequest) {
  const requestId = crypto.randomUUID();
  const ip = getClientIp(request);
  const userAgent = request.headers.get("user-agent") || null;
  const log = createRequestLogger({
    requestId,
    method: "POST",
    path: "/api/v1/leads",
    ip,
  });

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return apiValidationError({ body: ["Invalid JSON body"] });
  }

  // Validate tenant_id is present and valid
  const { valid, errors } = validate(body, {
    tenant_id: [required("tenant_id"), isUUID()],
  });
  if (!valid) return apiValidationError(errors);

  const tenantId = body.tenant_id as string;

  // Rate limit by tenant + IP
  const rateResult = await checkRateLimit(
    `form_submit:${tenantId}:${ip}`,
    FORM_SUBMIT_LIMIT
  );
  if (!rateResult.allowed) {
    if (rateResult.retryAfterSeconds > 0) {
      return apiRateLimited(rateResult.retryAfterSeconds);
    }
    return apiServiceUnavailable("Rate limiter unavailable");
  }

  const supabase = await createServiceClient();

  // Verify tenant exists
  const { data: tenant } = await supabase
    .from("tenants")
    .select("id")
    .eq("id", tenantId)
    .single();

  if (!tenant) return apiNotFound("Tenant");

  const idempotencyKey = body.idempotency_key as string | undefined;
  const leadId = body.lead_id as string | undefined;
  const sessionId = body.session_id as string | undefined;

  // Idempotency check
  if (idempotencyKey) {
    const { data: existing } = await supabase
      .from("leads")
      .select("*")
      .eq("tenant_id", tenantId)
      .eq("idempotency_key", idempotencyKey)
      .is("deleted_at", null)
      .single();

    if (existing) {
      log.info({ leadId: existing.id }, "Idempotent duplicate — returning existing lead");
      return apiSuccess(existing, 200);
    }
  }

  // Resolve status
  const resolvedStatus = (body.status as string) || (body.is_final ? "new" : "partial");

  // Resolve stage_id from status slug, fall back to tenant's default stage
  let { data: stage } = await supabase
    .from("pipeline_stages")
    .select("id, slug")
    .eq("tenant_id", tenantId)
    .eq("slug", resolvedStatus)
    .single();

  if (!stage) {
    const { data: defaultStage } = await supabase
      .from("pipeline_stages")
      .select("id, slug")
      .eq("tenant_id", tenantId)
      .eq("is_default", true)
      .single();
    stage = defaultStage;
  }

  if (!stage) {
    return apiValidationError({
      status: [`No matching pipeline stage for status "${resolvedStatus}"`],
    });
  }

  // Build payload from body
  const leadPayload: Record<string, unknown> = {
    tenant_id: tenantId,
    session_id: sessionId || body.session_id || null,
    step: body.step ?? 1,
    is_final: body.is_final ?? false,
    status: stage.slug,
    stage_id: stage.id,
    first_name: body.first_name || null,
    last_name: body.last_name || null,
    email: body.email || null,
    phone: body.phone || null,
    city: body.city || null,
    country: body.country || null,
    custom_fields: body.custom_fields || {},
    file_urls: body.file_urls || {},
    form_config_id: body.form_config_id || null,
    intake_source: body.intake_source || null,
    intake_medium: body.intake_medium || null,
    intake_campaign: body.intake_campaign || null,
    preferred_contact_method: body.preferred_contact_method || null,
    ...(idempotencyKey && { idempotency_key: idempotencyKey }),
  };

  // Update path: lead_id + session_id provided
  if (leadId && sessionId) {
    const { data: existingLead } = await supabase
      .from("leads")
      .select("*")
      .eq("id", leadId)
      .eq("tenant_id", tenantId)
      .eq("session_id", sessionId)
      .is("deleted_at", null)
      .single();

    if (!existingLead) {
      return apiNotFound("Lead");
    }

    // Remove tenant_id from update payload
    const { tenant_id: _, ...updatePayload } = leadPayload;

    const { data: updated, error } = await supabase
      .from("leads")
      .update(updatePayload)
      .eq("id", leadId)
      .eq("tenant_id", tenantId)
      .select()
      .single();

    if (error) {
      log.error({ err: error }, "Failed to update lead");
      return apiServiceUnavailable("Failed to update lead");
    }

    log.info({ leadId }, "Lead updated");

    Promise.all([
      createAuditLog({
        tenantId,
        action: "lead.updated",
        entityType: "lead",
        entityId: leadId,
        ipAddress: ip,
        userAgent,
        requestId,
      }),
      emitEvent({
        tenantId,
        type: "lead.updated",
        entityType: "lead",
        entityId: leadId,
        payload: { step: updated.step, is_final: updated.is_final },
        requestId,
      }),
    ]);

    return apiSuccess(updated, 200);
  }

  // Create path
  const { data: lead, error } = await supabase
    .from("leads")
    .insert(leadPayload)
    .select()
    .single();

  if (error) {
    // Check for idempotency constraint violation (race condition)
    if (error.code === "23505" && idempotencyKey) {
      const { data: existing } = await supabase
        .from("leads")
        .select("*")
        .eq("tenant_id", tenantId)
        .eq("idempotency_key", idempotencyKey)
        .is("deleted_at", null)
        .single();

      if (existing) {
        log.info({ leadId: existing.id }, "Race condition — returning existing lead");
        return apiSuccess(existing, 200);
      }
    }

    log.error({ err: error }, "Failed to create lead");
    return apiServiceUnavailable("Failed to create lead");
  }

  log.info({ leadId: lead.id }, "Lead created");

  Promise.all([
    createAuditLog({
      tenantId,
      action: "lead.created",
      entityType: "lead",
      entityId: lead.id,
      ipAddress: ip,
      userAgent,
      requestId,
    }),
    emitEvent({
      tenantId,
      type: "lead.created",
      entityType: "lead",
      entityId: lead.id,
      payload: { session_id: lead.session_id, is_final: lead.is_final },
      requestId,
    }),
  ]);

  return apiSuccess(lead, 201);
}
