import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { getClientIp } from "@/lib/api/auth";
import { authenticateIntegrationRequest } from "@/lib/api/integration-auth";
import {
  apiSuccess,
  apiError,
  apiValidationError,
  apiNotFound,
  apiRateLimited,
  apiUnauthorized,
  apiServiceUnavailable,
} from "@/lib/api/response";
import { checkRateLimit, INTEGRATION_LIMIT } from "@/lib/api/rate-limit";
import { createAuditLog, emitEvent } from "@/lib/api/audit";
import { createRequestLogger } from "@/lib/logger";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

function withCors(response: NextResponse): NextResponse {
  for (const [key, value] of Object.entries(CORS_HEADERS)) {
    response.headers.set(key, value);
  }
  return response;
}

// CORS preflight
export function OPTIONS() {
  return new NextResponse(null, { status: 200, headers: CORS_HEADERS });
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ tenantSlug: string; formSlug: string }> }
) {
  const { tenantSlug, formSlug } = await params;
  const requestId = crypto.randomUUID();
  const ip = getClientIp(request);
  const userAgent = request.headers.get("user-agent") || null;
  const log = createRequestLogger({
    requestId,
    method: "POST",
    path: `/api/public/submit/${tenantSlug}/${formSlug}`,
    ip,
  });

  // ── 1. Authenticate with API key ──
  const authResult = await authenticateIntegrationRequest(request);
  if (!authResult.success) {
    return withCors(apiUnauthorized());
  }

  // ── 2. Rate limit by integration key ──
  const rateResult = await checkRateLimit(
    `integration:${authResult.context.integrationKeyId}`,
    INTEGRATION_LIMIT
  );
  if (!rateResult.allowed) {
    return withCors(apiRateLimited(rateResult.retryAfterSeconds));
  }

  // ── 3. Parse body ──
  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return withCors(apiValidationError({ body: ["Invalid JSON body"] }));
  }

  const supabase = await createServiceClient();

  // ── 4. Lookup tenant by slug ──
  const { data: tenant } = await supabase
    .from("tenants")
    .select("id, name, slug, industry_id")
    .eq("slug", tenantSlug)
    .single();

  if (!tenant) {
    return withCors(apiNotFound("Tenant"));
  }

  // ── 5. Verify API key belongs to this tenant ──
  if (authResult.context.tenantId !== tenant.id) {
    log.warn(
      { keyTenant: authResult.context.tenantId, urlTenant: tenant.id },
      "API key tenant mismatch"
    );
    return withCors(
      apiError("FORBIDDEN", "API key does not belong to this tenant", 403)
    );
  }

  // ── 6. Lookup form config ──
  const { data: formConfig } = await supabase
    .from("form_configs")
    .select("id, tenant_id, slug, steps")
    .eq("tenant_id", tenant.id)
    .eq("slug", formSlug)
    .eq("is_active", true)
    .single();

  if (!formConfig) {
    return withCors(apiNotFound("Form"));
  }

  // ── 7. Idempotency check ──
  const idempotencyKey = body.idempotency_key as string | undefined;
  if (idempotencyKey) {
    const { data: existing } = await supabase
      .from("leads")
      .select("id, first_name, last_name, email, status, created_at")
      .eq("tenant_id", tenant.id)
      .eq("idempotency_key", idempotencyKey)
      .is("deleted_at", null)
      .single();

    if (existing) {
      log.info({ leadId: existing.id }, "Idempotent duplicate — returning existing");
      return withCors(apiSuccess({ lead_id: existing.id, duplicate: true }, 200));
    }
  }

  // ── 8. Get default pipeline + stage ──
  const { data: defaultPipeline } = await supabase
    .from("pipelines")
    .select("id")
    .eq("tenant_id", tenant.id)
    .eq("is_default", true)
    .single();

  if (!defaultPipeline) {
    log.error({ tenantId: tenant.id }, "No default pipeline");
    return withCors(apiServiceUnavailable("Tenant pipeline not configured"));
  }

  const { data: defaultStage } = await supabase
    .from("pipeline_stages")
    .select("id, slug")
    .eq("pipeline_id", defaultPipeline.id)
    .eq("is_default", true)
    .single();

  if (!defaultStage) {
    log.error({ pipelineId: defaultPipeline.id }, "No default stage");
    return withCors(apiServiceUnavailable("Pipeline stage not configured"));
  }

  // ── 9. Build phone with country code ──
  let phone = String(body.phone || "").trim() || null;
  // Normalize: replace spaces between country code and number with hyphen
  if (phone?.startsWith("+")) phone = phone.replace(/^(\+\d+)\s+/, "$1-");
  if (phone && !phone.startsWith("+") && body.country && formConfig.steps) {
    try {
      for (const step of formConfig.steps as Array<{ fields: Array<{ type: string; name: string; country_field?: string; options?: Array<{ value: string; dial_code?: string }> }> }>) {
        const phoneField = step.fields.find((f) => f.type === "tel" && f.country_field);
        if (phoneField?.country_field) {
          const countryField = step.fields.find((f) => f.name === phoneField.country_field);
          const opt = countryField?.options?.find((o) => o.value === body.country);
          if (opt?.dial_code) {
            phone = `${opt.dial_code}-${phone}`;
            break;
          }
        }
      }
    } catch { /* fall through to raw phone */ }
  }

  // ── 10. Generate display_id for education_consultancy ──
  let displayId: string | null = null;
  if (tenant.industry_id === "education_consultancy") {
    const prefix = (tenant.slug || "lead").slice(0, 3).toUpperCase();
    const { data: maxRow } = await supabase
      .from("leads")
      .select("display_id")
      .eq("tenant_id", tenant.id)
      .not("display_id", "is", null)
      .order("display_id", { ascending: false })
      .limit(1)
      .single();
    const lastNum = maxRow?.display_id ? parseInt(maxRow.display_id.split("-").pop() || "0", 10) : 0;
    displayId = `${prefix}-${(lastNum + 1).toString().padStart(3, "0")}`;
  }

  // ── 11. Insert lead ──
  const leadPayload = {
    tenant_id: tenant.id,
    pipeline_id: defaultPipeline.id,
    stage_id: defaultStage.id,
    status: defaultStage.slug,
    form_config_id: formConfig.id,
    is_final: true,
    step: 1,
    first_name: body.first_name || null,
    last_name: body.last_name || null,
    email: body.email || null,
    phone,
    city: body.city || null,
    country: body.country || null,
    custom_fields: body.custom_fields || {},
    file_urls: body.file_urls || {},
    entity_id: body.entity_id || null,
    intake_source: body.intake_source || "api",
    intake_medium: body.intake_medium || null,
    intake_campaign: body.intake_campaign || null,
    preferred_contact_method: body.preferred_contact_method || null,
    tags: Array.isArray(body.tags) ? body.tags : ["student"],
    ...(displayId && { display_id: displayId }),
    ...(idempotencyKey && { idempotency_key: idempotencyKey }),
  };

  const { data: lead, error } = await supabase
    .from("leads")
    .insert(leadPayload)
    .select("id")
    .single();

  if (error) {
    // Race condition on idempotency key
    if (error.code === "23505" && idempotencyKey) {
      const { data: existing } = await supabase
        .from("leads")
        .select("id")
        .eq("tenant_id", tenant.id)
        .eq("idempotency_key", idempotencyKey)
        .is("deleted_at", null)
        .single();

      if (existing) {
        return withCors(apiSuccess({ lead_id: existing.id, duplicate: true }, 200));
      }
    }

    log.error({ err: error }, "Failed to create lead");
    return withCors(apiServiceUnavailable("Failed to create lead"));
  }

  log.info({ leadId: lead.id }, "Lead created via public API");

  // Fire-and-forget: audit + event
  Promise.all([
    createAuditLog({
      tenantId: tenant.id,
      userId: null,
      action: "lead.created",
      entityType: "lead",
      entityId: lead.id,
      changes: {
        source: { old: null, new: "public_api" },
        integration_key: { old: null, new: authResult.context.integrationKeyId },
      },
      ipAddress: ip,
      userAgent,
      requestId,
    }),
    emitEvent({
      tenantId: tenant.id,
      type: "lead.created",
      entityType: "lead",
      entityId: lead.id,
      payload: {
        source: "public_api",
        form_slug: formSlug,
        integration_key_id: authResult.context.integrationKeyId,
      },
      requestId,
    }),
  ]);

  return withCors(apiSuccess({ lead_id: lead.id }, 201));
}
