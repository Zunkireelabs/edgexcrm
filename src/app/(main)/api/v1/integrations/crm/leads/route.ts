import { NextRequest } from "next/server";
import {
  gateIntegrationRequest,
  buildLookupMaps,
  normalizeLead,
  logIntegrationAudit,
  emitIntegrationEvent,
  withIntegrationErrorBoundary,
} from "@/lib/api/integration-helpers";
import {
  normalizeEmail,
  normalizePhone,
  resolveLeadIdentity,
  applyCanonicalUpdate,
  recordSubmission,
  recordDuplicateSuggestions,
} from "@/lib/leads/dedup";
import {
  apiSuccess,
  apiValidationError,
  apiServiceUnavailable,
} from "@/lib/api/response";
import { requirePermission } from "@/lib/api/integration-permissions";
import { validate, required, isEmail } from "@/lib/api/validation";
import type { Lead } from "@/types/database";

// GET /api/v1/integrations/crm/leads
export const GET = withIntegrationErrorBoundary(async function GET(request: NextRequest) {
  const gate = await gateIntegrationRequest(request);
  if (!gate.ok) return gate.response;
  const { ctx } = gate;

  const denied = requirePermission(ctx.auth, "read");
  if (denied) return denied;

  const searchParams = request.nextUrl.searchParams;
  const stageId = searchParams.get("stage_id");
  const assignedTo = searchParams.get("assigned_to");
  const email = searchParams.get("email");
  const search = searchParams.get("search");
  const limit = Math.min(100, Math.max(1, parseInt(searchParams.get("limit") || "50", 10)));
  const offset = Math.max(0, parseInt(searchParams.get("offset") || "0", 10));

  let query = ctx.supabase
    .from("leads")
    .select("*", { count: "exact" })
    .eq("tenant_id", ctx.auth.tenantId)
    .is("deleted_at", null);

  if (stageId) {
    query = query.eq("stage_id", stageId);
  }
  if (assignedTo) {
    query = query.eq("assigned_to", assignedTo);
  }
  if (email) {
    // Case-insensitive exact match on email — returns 200 with empty array if none found
    query = query.ilike("email", email);
  }
  if (search) {
    query = query.or(
      `first_name.ilike.%${search}%,last_name.ilike.%${search}%,email.ilike.%${search}%,phone.ilike.%${search}%`
    );
  }

  const { data, error, count } = await query
    .order("created_at", { ascending: false })
    .range(offset, offset + limit - 1);

  if (error) {
    return apiServiceUnavailable("Failed to fetch leads");
  }

  const { stageMap, userMap } = await buildLookupMaps(ctx.supabase, ctx.auth.tenantId);
  const normalized = (data as Lead[]).map((lead) => normalizeLead(lead, stageMap, userMap));

  return apiSuccess({
    leads: normalized,
    total: count || 0,
    limit,
    offset,
  });
});

// POST /api/v1/integrations/crm/leads
export const POST = withIntegrationErrorBoundary(async function POST(request: NextRequest) {
  const gate = await gateIntegrationRequest(request);
  if (!gate.ok) return gate.response;
  const { ctx } = gate;

  const denied = requirePermission(ctx.auth, "write");
  if (denied) return denied;

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return apiValidationError({ body: ["Invalid JSON body"] });
  }

  const { valid, errors } = validate(body, {
    first_name: [required("first_name")],
    email: [required("email"), isEmail()],
  });
  if (!valid) return apiValidationError(errors);

  const tenantId = ctx.auth.tenantId;
  const normalizedEmail = normalizeEmail(body.email as string);
  const normalizedPhone = normalizePhone((body.phone as string | undefined) ?? null);

  // Idempotency check via header
  const idempotencyKey = request.headers.get("idempotency-key");
  if (idempotencyKey) {
    const { data: existing } = await ctx.supabase
      .from("leads")
      .select("*")
      .eq("tenant_id", tenantId)
      .eq("idempotency_key", idempotencyKey)
      .is("deleted_at", null)
      .single();

    if (existing) {
      const { stageMap, userMap } = await buildLookupMaps(ctx.supabase, tenantId);
      return apiSuccess(normalizeLead(existing as Lead, stageMap, userMap), 200);
    }
  }

  // ── Dedup: identity resolution ──
  const identity = await resolveLeadIdentity(ctx.supabase, {
    tenantId,
    normalizedEmail,
    normalizedPhone,
  });

  if (identity.match === "email" && identity.existingLead) {
    const canonical = identity.existingLead;
    let submissionId: string | undefined;
    try {
      submissionId = await recordSubmission(ctx.supabase, {
        tenantId,
        leadId: canonical.id,
        createdVia: "integration",
        idempotencyKey: idempotencyKey ?? null,
        firstName: (body.first_name as string) || null,
        lastName: (body.last_name as string) || null,
        email: (body.email as string) || null,
        phone: (body.phone as string) || null,
        city: (body.city as string) || null,
        country: (body.country as string) || null,
        normalizedEmail,
        normalizedPhone,
        customFields: (body.custom_fields as Record<string, unknown>) ?? {},
        fileUrls: (body.file_urls as Record<string, unknown>) ?? {},
        intakeSource: (body.intake_source as string) || null,
        intakeMedium: (body.intake_medium as string) || null,
        intakeCampaign: (body.intake_campaign as string) || null,
        rawPayload: body,
        matchedExisting: true,
      });
    } catch { /* non-fatal — canonical lead exists, submission not logged */ }

    const patch = applyCanonicalUpdate(canonical, {
      first_name: (body.first_name as string) || null,
      last_name: (body.last_name as string) || null,
      email: (body.email as string) || null,
      phone: (body.phone as string) || null,
      city: (body.city as string) || null,
      country: (body.country as string) || null,
      custom_fields: body.custom_fields as Record<string, unknown> | undefined,
      file_urls: body.file_urls as Record<string, unknown> | undefined,
    });
    if (Object.keys(patch).length > 0) {
      await ctx.supabase.from("leads").update(patch).eq("id", canonical.id).eq("tenant_id", tenantId);
    }

    void logIntegrationAudit(ctx, "integration.lead.submission", "lead", canonical.id);
    void emitIntegrationEvent(ctx, "lead.submission", "lead", canonical.id, {
      submission_id: submissionId ?? null,
      is_first: false,
      matched_existing: true,
    });

    const { stageMap: sm, userMap: um } = await buildLookupMaps(ctx.supabase, tenantId);
    return apiSuccess(normalizeLead(canonical, sm, um), 200);
  }

  // Resolve stage: use provided stage_id, or status slug, or default
  let stageId: string | null = null;
  let statusSlug: string | null = null;

  if (body.stage_id && typeof body.stage_id === "string") {
    const { data: stage } = await ctx.supabase
      .from("pipeline_stages")
      .select("id, slug")
      .eq("id", body.stage_id)
      .eq("tenant_id", tenantId)
      .single();

    if (!stage) {
      return apiValidationError({ stage_id: ["Invalid stage_id for this tenant"] });
    }
    stageId = stage.id;
    statusSlug = stage.slug;
  } else if (body.status && typeof body.status === "string") {
    const { data: stage } = await ctx.supabase
      .from("pipeline_stages")
      .select("id, slug")
      .eq("tenant_id", tenantId)
      .eq("slug", body.status)
      .single();

    if (!stage) {
      return apiValidationError({ status: [`No matching pipeline stage for "${body.status}"`] });
    }
    stageId = stage.id;
    statusSlug = stage.slug;
  } else {
    const { data: defaultStage } = await ctx.supabase
      .from("pipeline_stages")
      .select("id, slug")
      .eq("tenant_id", tenantId)
      .eq("is_default", true)
      .single();

    if (!defaultStage) {
      return apiValidationError({ stage: ["No default pipeline stage configured for this tenant"] });
    }
    stageId = defaultStage.id;
    statusSlug = defaultStage.slug;
  }

  const leadPayload: Record<string, unknown> = {
    tenant_id: tenantId,
    first_name: body.first_name as string,
    last_name: (body.last_name as string) || null,
    email: body.email as string,
    phone: (body.phone as string) || null,
    city: (body.city as string) || null,
    country: (body.country as string) || null,
    status: statusSlug,
    stage_id: stageId,
    is_final: true,
    step: 1,
    custom_fields: (body.custom_fields as Record<string, unknown>) || {},
    file_urls: (body.file_urls as Record<string, string>) || {},
    intake_source: (body.intake_source as string) || "integration",
    intake_medium: (body.intake_medium as string) || null,
    intake_campaign: (body.intake_campaign as string) || null,
    preferred_contact_method: (body.preferred_contact_method as string) || null,
    ...(idempotencyKey && { idempotency_key: idempotencyKey }),
  };

  const { data: lead, error } = await ctx.supabase
    .from("leads")
    .insert(leadPayload)
    .select()
    .single();

  if (error) {
    if (error.code === "23505") {
      // Idempotency key race
      if (idempotencyKey) {
        const { data: existing } = await ctx.supabase
          .from("leads")
          .select("*")
          .eq("tenant_id", tenantId)
          .eq("idempotency_key", idempotencyKey)
          .is("deleted_at", null)
          .single();
        if (existing) {
          const { stageMap, userMap } = await buildLookupMaps(ctx.supabase, tenantId);
          return apiSuccess(normalizeLead(existing as Lead, stageMap, userMap), 200);
        }
      }
      // Email unique-index race — concurrent insert won; re-lookup and fold
      if (normalizedEmail) {
        const { data: raceMatch } = await ctx.supabase
          .from("leads")
          .select("*")
          .eq("tenant_id", tenantId)
          .eq("normalized_email", normalizedEmail)
          .is("deleted_at", null)
          .eq("is_final", true)
          .order("created_at", { ascending: true })
          .limit(1)
          .maybeSingle();
        if (raceMatch) {
          try {
            await recordSubmission(ctx.supabase, {
              tenantId,
              leadId: (raceMatch as Lead).id,
              createdVia: "integration",
              idempotencyKey: idempotencyKey ?? null,
              email: (body.email as string) || null,
              normalizedEmail,
              normalizedPhone,
              rawPayload: body,
              matchedExisting: true,
            });
          } catch { /* non-fatal */ }
          const { stageMap, userMap } = await buildLookupMaps(ctx.supabase, tenantId);
          return apiSuccess(normalizeLead(raceMatch as Lead, stageMap, userMap), 200);
        }
      }
    }
    return apiServiceUnavailable("Failed to create lead");
  }

  // New lead — record submission
  let submissionId: string | undefined;
  try {
    submissionId = await recordSubmission(ctx.supabase, {
      tenantId,
      leadId: (lead as Lead).id,
      createdVia: "integration",
      idempotencyKey: idempotencyKey ?? null,
      firstName: (lead as Lead).first_name,
      lastName: (lead as Lead).last_name,
      email: (lead as Lead).email,
      phone: (lead as Lead).phone,
      city: (lead as Lead).city,
      country: (lead as Lead).country,
      normalizedEmail,
      normalizedPhone,
      customFields: (lead as Lead).custom_fields as Record<string, unknown>,
      fileUrls: (lead as Lead).file_urls as Record<string, unknown>,
      intakeSource: (lead as Lead).intake_source,
      intakeMedium: (lead as Lead).intake_medium,
      intakeCampaign: (lead as Lead).intake_campaign,
      rawPayload: body,
      matchedExisting: false,
    });
  } catch { /* non-fatal — lead created, submission not logged */ }

  // Phone duplicate suggestions — non-fatal, never blocks ingestion
  if (identity.phoneMatchLeadIds.length > 0) {
    try {
      await recordDuplicateSuggestions(ctx.supabase, {
        tenantId,
        leadId: (lead as Lead).id,
        suggestedLeadIds: identity.phoneMatchLeadIds,
        reason: "phone",
      });
    } catch { /* non-fatal */ }
  }

  const { stageMap, userMap } = await buildLookupMaps(ctx.supabase, ctx.auth.tenantId);

  await Promise.all([
    // integration.lead.created audit suppressed when lead.submission was recorded (A4: combined display)
    submissionId
      ? Promise.resolve()
      : logIntegrationAudit(ctx, "integration.lead.created", "lead", (lead as Lead).id),
    emitIntegrationEvent(ctx, "lead.created", "lead", (lead as Lead).id, {
      email: (lead as Lead).email,
      stage_id: (lead as Lead).stage_id,
    }),
    submissionId
      ? emitIntegrationEvent(ctx, "lead.submission", "lead", (lead as Lead).id, {
          submission_id: submissionId,
          is_first: true,
          matched_existing: false,
        })
      : Promise.resolve(),
  ]);

  return apiSuccess(normalizeLead(lead as Lead, stageMap, userMap), 201);
});
