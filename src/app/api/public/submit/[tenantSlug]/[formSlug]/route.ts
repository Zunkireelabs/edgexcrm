import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { getClientIp } from "@/lib/api/auth";
import { authenticateIntegrationRequest } from "@/lib/api/integration-auth";
import { validateSubmissionAgainstForm } from "@/lib/leads/form-validation";
import { requirePermission } from "@/lib/api/integration-permissions";
import type { FormStep, FormConfig, Lead } from "@/types/database";
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
import {
  upsertThreadNotification,
  getTenantAdminRecipients,
  NotificationTypes,
} from "@/lib/notifications";
import {
  normalizeEmail,
  normalizePhone,
  resolveLeadIdentity,
  applyCanonicalUpdate,
  recordSubmission,
  recordDuplicateSuggestions,
  emitSubmissionAudit,
  touchLastActivity,
} from "@/lib/leads/dedup";
import { resolveLeadPipelineAndStage } from "@/lib/leads/pipeline-resolution";
import { processEmailForwardRules } from "@/lib/email/email-forward";
import { processFormAutoresponder } from "@/lib/email/form-autoresponder";

const CORS_STATIC_HEADERS = {
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

// corsOrigin meanings:
//   "*"    → wildcard (pre-auth fallback, and keys with no allowlist)
//   string → specific origin to reflect (+ Vary: Origin)
//   null   → omit ACAO entirely (hard-blocked origin path)
function withCors(response: NextResponse, corsOrigin: string | null = "*"): NextResponse {
  if (corsOrigin !== null) {
    response.headers.set("Access-Control-Allow-Origin", corsOrigin);
  }
  if (corsOrigin && corsOrigin !== "*") {
    response.headers.set("Vary", "Origin");
  }
  for (const [key, value] of Object.entries(CORS_STATIC_HEADERS)) {
    response.headers.set(key, value);
  }
  return response;
}

// CORS preflight — permissive because we don't know the key at OPTIONS time
// (Authorization header is absent on preflight); enforcement happens on POST.
export function OPTIONS() {
  return new NextResponse(null, {
    status: 200,
    headers: {
      "Access-Control-Allow-Origin": "*",
      ...CORS_STATIC_HEADERS,
    },
  });
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
    return withCors(apiUnauthorized()); // pre-auth: permissive wildcard
  }

  // ── 2. Rate limit by integration key ──
  const rateResult = await checkRateLimit(
    `integration:${authResult.context.integrationKeyId}`,
    INTEGRATION_LIMIT
  );
  if (!rateResult.allowed) {
    return withCors(apiRateLimited(rateResult.retryAfterSeconds)); // pre-origin-check: wildcard
  }

  // ── 2a. Per-key origin enforcement ──
  // CORS preflights arrive without Authorization, so enforcement must happen here on the actual POST.
  const reqOrigin = request.headers.get("origin");
  const allow = authResult.context.allowedOrigins;
  let corsOrigin: string | null = "*"; // default: wildcard (no allowlist on this key)
  if (allow && allow.length > 0) {
    if (reqOrigin) {
      if (allow.includes(reqOrigin)) {
        corsOrigin = reqOrigin; // reflect allowed origin
      } else {
        // Hard block — disallowed browser origin; no lead will be created
        return withCors(
          apiError("FORBIDDEN", "Origin not allowed for this API key", 403),
          null
        );
      }
    } else {
      // No Origin header → server-side caller (curl, backend); CORS N/A, allow through
      corsOrigin = null;
    }
  }

  // Convenience wrapper so all post-auth returns carry the resolved CORS origin
  const cors = (r: NextResponse) => withCors(r, corsOrigin);

  // ── 3. Parse body ──
  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return cors(apiValidationError({ body: ["Invalid JSON body"] }));
  }

  const supabase = await createServiceClient();

  // ── 4. Lookup tenant by slug ──
  const { data: tenant } = await supabase
    .from("tenants")
    .select("id, name, slug, industry_id")
    .eq("slug", tenantSlug)
    .single();

  if (!tenant) {
    return cors(apiNotFound("Tenant"));
  }

  // ── 5. Verify API key belongs to this tenant ──
  if (authResult.context.tenantId !== tenant.id) {
    log.warn(
      { keyTenant: authResult.context.tenantId, urlTenant: tenant.id },
      "API key tenant mismatch"
    );
    return cors(
      apiError("FORBIDDEN", "API key does not belong to this tenant", 403)
    );
  }

  // ── 6a. Enforce write permission ──
  const denied = requirePermission(authResult.context, "write");
  if (denied) return cors(denied as NextResponse);

  // ── 6. Lookup form config ──
  const { data: formConfig } = await supabase
    .from("form_configs")
    .select("id, tenant_id, slug, name, steps, attribution, target_pipeline_id, autoresponder")
    .eq("tenant_id", tenant.id)
    .eq("slug", formSlug)
    .eq("is_active", true)
    .single();

  if (!formConfig) {
    return cors(apiNotFound("Form"));
  }

  // ── 6b. Per-form key binding check ──
  if (authResult.context.formId && authResult.context.formId !== formConfig.id) {
    return cors(apiError("FORBIDDEN", "API key is not authorized for this form", 403));
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
      return cors(apiSuccess({ lead_id: existing.id, duplicate: true }, 200));
    }
  }

  // ── 8. Resolve pipeline + entry stage ──
  const resolved = await resolveLeadPipelineAndStage(supabase, { tenantId: tenant.id, formConfig, log });

  if (!resolved.ok) {
    if (resolved.reason === "no_pipeline") {
      return cors(apiServiceUnavailable("Tenant pipeline not configured"));
    }
    return cors(apiServiceUnavailable("Pipeline stage not configured"));
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

  // ── Mode B schema validation — log-only, never rejects ──
  if (formConfig.steps && (formConfig.steps as unknown[]).length > 0) {
    const schemaValues = {
      ...((body.custom_fields as Record<string, unknown>) || {}),
      first_name: body.first_name,
      last_name: body.last_name,
      email: body.email,
      phone: body.phone,
      city: body.city,
      country: body.country,
    };
    const schemaResult = validateSubmissionAgainstForm(
      formConfig.steps as FormStep[],
      schemaValues
    );
    if (!schemaResult.valid) {
      log.warn(
        { formId: formConfig.id, formSlug, errors: schemaResult.errors },
        "Mode B submission failed schema validation (log-only, not rejected)"
      );
    }
  }

  // ── 10. Dedup: resolve identity ──
  const normalizedEmail = normalizeEmail(body.email as string | undefined);
  const normalizedPhone = normalizePhone(phone);
  const identity = await resolveLeadIdentity(supabase, {
    tenantId: tenant.id,
    normalizedEmail,
    normalizedPhone,
  });

  if (identity.match === "email" && identity.existingLead) {
    const canonical = identity.existingLead;
    let submissionId: string | undefined;
    try {
      submissionId = await recordSubmission(supabase, {
        tenantId: tenant.id,
        leadId: canonical.id,
        formConfigId: formConfig.id,
        createdVia: "public_form",
        idempotencyKey: idempotencyKey ?? null,
        firstName: (body.first_name as string) || null,
        lastName: (body.last_name as string) || null,
        email: (body.email as string) || null,
        phone,
        city: (body.city as string) || null,
        country: (body.country as string) || null,
        normalizedEmail,
        normalizedPhone,
        customFields: (body.custom_fields as Record<string, unknown>) ?? {},
        fileUrls: (body.file_urls as Record<string, unknown>) ?? {},
        intakeSource: (body.intake_source as string) || (formConfig.attribution?.default_source ?? null),
        intakeMedium: (body.intake_medium as string) || (formConfig.attribution?.default_medium ?? null),
        intakeCampaign: (body.intake_campaign as string) || (formConfig.attribution?.default_campaign ?? null),
        entityId: (body.entity_id as string) || null,
        rawPayload: body,
        matchedExisting: true,
      });
    } catch { /* non-fatal — canonical lead exists, submission not logged */ }

    const patch = applyCanonicalUpdate(canonical, {
      first_name: (body.first_name as string) || null,
      last_name: (body.last_name as string) || null,
      email: (body.email as string) || null,
      phone,
      city: (body.city as string) || null,
      country: (body.country as string) || null,
      entity_id: (body.entity_id as string) || null,
      custom_fields: (body.custom_fields as Record<string, unknown>) ?? {},
      file_urls: (body.file_urls as Record<string, unknown>) ?? {},
      tags: Array.isArray(body.tags) ? (body.tags as string[]) : [],
    });
    if (Object.keys(patch).length > 0) {
      await supabase.from("leads").update(patch).eq("id", canonical.id).eq("tenant_id", tenant.id);
    }

    const canonicalId = canonical.id;
    void emitSubmissionAudit(supabase, {
      tenantId: tenant.id,
      leadId: canonicalId,
      submissionId: submissionId ?? null,
      isFirst: false,
      matchedExisting: true,
      formName: (formConfig as { name?: string }).name ?? null,
      ipAddress: ip,
      userAgent,
      requestId,
    });
    void touchLastActivity(supabase, { leadId: canonicalId, tenantId: tenant.id });
    (async () => {
      try {
        const fn = (body.first_name as string | null) || null;
        const ln = (body.last_name as string | null) || null;
        const leadName = `${fn || ""} ${ln || ""}`.trim() || "A lead";
        if (canonical.assigned_to) {
          await upsertThreadNotification({
            tenantId: tenant.id,
            userId: canonical.assigned_to,
            type: NotificationTypes.LEAD_CREATED,
            title: "Resubmission from existing lead",
            message: leadName,
            link: `/leads/${canonicalId}`,
          });
        } else {
          const adminIds = await getTenantAdminRecipients(supabase, tenant.id);
          await Promise.all(
            adminIds.map((adminId) =>
              upsertThreadNotification({
                tenantId: tenant.id,
                userId: adminId,
                type: NotificationTypes.LEAD_CREATED,
                title: "Resubmission from existing lead",
                message: leadName,
                link: `/leads/${canonicalId}`,
              })
            )
          );
        }
      } catch (err) {
        log.error({ err }, "Failed to send resubmission notification");
      }
    })();

    void processEmailForwardRules({
      tenantId: tenant.id,
      lead: canonical as Lead,
      newStageId: resolved.stageId,
    }).catch((err) => log.error({ err }, "Email rule on resubmit failed"));

    void processFormAutoresponder(
      formConfig as FormConfig,
      { ...canonical, ...patch } as Lead,
      { isResubmission: true, tenant: { name: tenant.name } }
    ).catch(() => {});

    return cors(apiSuccess({ lead_id: canonicalId, deduped: true }, 200));
  }

  // ── 11. Generate display_id for education_consultancy ──
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
    pipeline_id: resolved.pipelineId,
    stage_id: resolved.stageId,
    status: resolved.statusSlug,
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
    intake_source: body.intake_source
      || (tenant.industry_id === "education_consultancy" ? formConfig.attribution?.default_source : null)
      || "api",
    intake_medium: body.intake_medium
      || (tenant.industry_id === "education_consultancy" ? formConfig.attribution?.default_medium : null)
      || null,
    intake_campaign: body.intake_campaign
      || (tenant.industry_id === "education_consultancy" ? formConfig.attribution?.default_campaign : null)
      || null,
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
    if (error.code === "23505") {
      // Idempotency key race
      if (idempotencyKey) {
        const { data: existing } = await supabase
          .from("leads")
          .select("id")
          .eq("tenant_id", tenant.id)
          .eq("idempotency_key", idempotencyKey)
          .is("deleted_at", null)
          .single();
        if (existing) {
          return cors(apiSuccess({ lead_id: existing.id, duplicate: true }, 200));
        }
      }
      // Email unique-index race — concurrent insert won; fold into winner
      if (normalizedEmail) {
        const { data: raceMatch } = await supabase
          .from("leads")
          .select("id")
          .eq("tenant_id", tenant.id)
          .eq("normalized_email", normalizedEmail)
          .is("deleted_at", null)
          .eq("is_final", true)
          .order("created_at", { ascending: true })
          .limit(1)
          .maybeSingle();
        if (raceMatch) {
          let raceSubmissionId: string | undefined;
          try {
            raceSubmissionId = await recordSubmission(supabase, {
              tenantId: tenant.id,
              leadId: (raceMatch as { id: string }).id,
              formConfigId: formConfig.id,
              createdVia: "public_form",
              idempotencyKey: idempotencyKey ?? null,
              email: (body.email as string) || null,
              normalizedEmail,
              normalizedPhone,
              rawPayload: body,
              matchedExisting: true,
            });
          } catch { /* non-fatal */ }
          void emitSubmissionAudit(supabase, {
            tenantId: tenant.id,
            leadId: (raceMatch as { id: string }).id,
            submissionId: raceSubmissionId ?? null,
            isFirst: false,
            matchedExisting: true,
            formName: (formConfig as { name?: string }).name ?? null,
            ipAddress: ip,
            userAgent,
            requestId,
          });
          void touchLastActivity(supabase, { leadId: (raceMatch as { id: string }).id, tenantId: tenant.id });
          return cors(apiSuccess({ lead_id: (raceMatch as { id: string }).id, deduped: true }, 200));
        }
      }
    }
    log.error({ err: error }, "Failed to create lead");
    return cors(apiServiceUnavailable("Failed to create lead"));
  }

  log.info({ leadId: lead.id }, "Lead created via public API");

  // Record submission + fire-and-forget: audit + event + notifications
  const leadId = lead.id;
  const tenantForNotify = tenant;
  const leadPayloadForNotify = leadPayload;

  let submissionId: string | undefined;
  try {
    submissionId = await recordSubmission(supabase, {
      tenantId: tenant.id,
      leadId,
      formConfigId: formConfig.id,
      createdVia: "public_form",
      idempotencyKey: idempotencyKey ?? null,
      firstName: leadPayload.first_name as string | null,
      lastName: leadPayload.last_name as string | null,
      email: leadPayload.email as string | null,
      phone: leadPayload.phone as string | null,
      city: leadPayload.city as string | null,
      country: leadPayload.country as string | null,
      normalizedEmail,
      normalizedPhone,
      customFields: leadPayload.custom_fields as Record<string, unknown>,
      fileUrls: leadPayload.file_urls as Record<string, unknown>,
      intakeSource: leadPayload.intake_source as string | null,
      intakeMedium: leadPayload.intake_medium as string | null,
      intakeCampaign: leadPayload.intake_campaign as string | null,
      entityId: leadPayload.entity_id as string | null,
      rawPayload: body,
      matchedExisting: false,
    });
  } catch (err) {
    log.error({ err }, "Failed to record submission");
  }

  // Phone duplicate suggestions — non-fatal, never blocks ingestion
  if (identity.phoneMatchLeadIds.length > 0) {
    try {
      await recordDuplicateSuggestions(supabase, {
        tenantId: tenant.id,
        leadId,
        suggestedLeadIds: identity.phoneMatchLeadIds,
        reason: "phone",
      });
    } catch { /* non-fatal */ }
  }

  if (submissionId) {
    void touchLastActivity(supabase, { leadId, tenantId: tenant.id });
    void emitSubmissionAudit(supabase, {
      tenantId: tenant.id,
      leadId,
      submissionId,
      isFirst: true,
      matchedExisting: false,
      formName: (formConfig as { name?: string }).name ?? null,
      ipAddress: ip,
      userAgent,
      requestId,
    });
  }

  Promise.all([
    // lead.created audit suppressed when lead.submission was recorded (A4: combined display)
    submissionId
      ? Promise.resolve()
      : createAuditLog({
          tenantId: tenant.id,
          userId: null,
          action: "lead.created",
          entityType: "lead",
          entityId: leadId,
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
      entityId: leadId,
      payload: {
        source: "public_api",
        form_slug: formSlug,
        integration_key_id: authResult.context.integrationKeyId,
      },
      requestId,
    }),
    (async () => {
      try {
        const fn = leadPayloadForNotify.first_name as string | null;
        const ln = leadPayloadForNotify.last_name as string | null;
        const leadName = `${fn || ""} ${ln || ""}`.trim() || "A lead";
        const adminIds = await getTenantAdminRecipients(supabase, tenantForNotify.id);
        await Promise.all(
          adminIds.map((adminId) =>
            upsertThreadNotification({
              tenantId: tenantForNotify.id,
              userId: adminId,
              type: NotificationTypes.LEAD_CREATED,
              title: "New lead",
              message: leadName,
              link: `/leads/${leadId}`,
            })
          )
        );
      } catch (err) {
        log.error({ err }, "Failed to create lead.created notification");
      }
    })(),
  ]);

  void processEmailForwardRules({
    tenantId: tenant.id,
    lead: {
      id: leadId,
      first_name: leadPayload.first_name as string | null,
      last_name: leadPayload.last_name as string | null,
      email: leadPayload.email as string | null,
      phone: leadPayload.phone as string | null,
    } as Lead,
    newStageId: resolved.stageId,
  }).catch((err) => log.error({ err }, "Email rule on create failed"));

  void processFormAutoresponder(
    formConfig as FormConfig,
    { ...leadPayload, id: leadId } as Lead,
    { isResubmission: false, tenant: { name: tenant.name } }
  ).catch(() => {});

  return cors(apiSuccess({ lead_id: leadId }, 201));
}
