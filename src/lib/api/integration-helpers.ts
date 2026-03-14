import { NextRequest } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import {
  authenticateIntegrationRequest,
  type IntegrationAuthContext,
} from "@/lib/api/integration-auth";
import { checkRateLimit, INTEGRATION_LIMIT } from "@/lib/api/rate-limit";
import {
  apiError,
  apiUnauthorized,
  apiRateLimited,
  apiServiceUnavailable,
  setRateLimitInfo,
} from "@/lib/api/response";
import { getClientIp } from "@/lib/api/auth";
import { createAuditLog, emitEvent } from "@/lib/api/audit";
import { createRequestLogger } from "@/lib/logger";
import type { Lead, PipelineStage } from "@/types/database";

// ── Auth + Rate Limit gate ────────────────────────────────────────

export interface IntegrationRequestContext {
  auth: IntegrationAuthContext;
  supabase: Awaited<ReturnType<typeof createServiceClient>>;
  requestId: string;
  ip: string;
  userAgent: string | null;
}

/**
 * Authenticate & rate-limit an integration request.
 * Returns context on success, or a NextResponse on failure.
 */
export async function gateIntegrationRequest(
  request: NextRequest
): Promise<
  | { ok: true; ctx: IntegrationRequestContext }
  | { ok: false; response: Response }
> {
  const authResult = await authenticateIntegrationRequest(request);
  if (!authResult.success) {
    return {
      ok: false,
      response: authResult.status === 401
        ? apiUnauthorized()
        : apiError("FORBIDDEN", authResult.error, authResult.status),
    };
  }

  const { context: auth } = authResult;

  // Rate limit per integration key
  const rateKey = `integration:${auth.integrationKeyId}`;
  const rateResult = await checkRateLimit(rateKey, INTEGRATION_LIMIT);

  // Always set rate limit info so all responses carry the headers
  setRateLimitInfo({
    limit: rateResult.limit,
    remaining: rateResult.remaining,
    resetAt: rateResult.resetAt,
  });

  if (!rateResult.allowed) {
    if (rateResult.retryAfterSeconds > 0) {
      return { ok: false, response: apiRateLimited(rateResult.retryAfterSeconds) };
    }
    return { ok: false, response: apiServiceUnavailable("Rate limiter unavailable") };
  }

  const supabase = await createServiceClient();

  return {
    ok: true,
    ctx: {
      auth,
      supabase,
      requestId: crypto.randomUUID(),
      ip: getClientIp(request),
      userAgent: request.headers.get("user-agent"),
    },
  };
}

// ── Lead Normalization ────────────────────────────────────────────

interface StageInfo {
  id: string;
  slug: string;
  name: string;
}

interface UserInfo {
  user_id: string;
  email: string;
}

export interface NormalizedLead {
  id: string;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  phone: string | null;
  city: string | null;
  country: string | null;
  status: string;
  stage_id: string | null;
  stage_slug: string | null;
  stage_name: string | null;
  assigned_to: string | null;
  assigned_name: string | null;
  custom_fields: Record<string, unknown>;
  file_urls: Record<string, string>;
  intake_source: string | null;
  intake_medium: string | null;
  intake_campaign: string | null;
  preferred_contact_method: string | null;
  is_final: boolean;
  created_at: string;
  updated_at: string;
}

export interface NormalizedLeadDetail extends NormalizedLead {
  checklist_total: number;
  checklist_completed: number;
}

/**
 * Build lookup maps for stages and team members for a tenant.
 */
export async function buildLookupMaps(
  supabase: Awaited<ReturnType<typeof createServiceClient>>,
  tenantId: string
): Promise<{
  stageMap: Map<string, StageInfo>;
  userMap: Map<string, string>;
}> {
  const [stagesResult, membersResult] = await Promise.all([
    supabase
      .from("pipeline_stages")
      .select("id, slug, name")
      .eq("tenant_id", tenantId)
      .order("position", { ascending: true }),
    supabase
      .from("tenant_users")
      .select("user_id")
      .eq("tenant_id", tenantId),
  ]);

  const stageMap = new Map<string, StageInfo>();
  for (const s of stagesResult.data || []) {
    stageMap.set(s.id, { id: s.id, slug: s.slug, name: s.name });
  }

  // Resolve emails via auth admin
  const userMap = new Map<string, string>();
  const memberIds = (membersResult.data || []).map((m) => m.user_id);
  if (memberIds.length > 0) {
    const { data: authData } = await supabase.auth.admin.listUsers();
    for (const u of authData?.users || []) {
      if (memberIds.includes(u.id)) {
        userMap.set(u.id, u.email || "Unknown");
      }
    }
  }

  return { stageMap, userMap };
}

/**
 * Normalize a raw lead row into AI-friendly JSON.
 */
export function normalizeLead(
  lead: Lead,
  stageMap: Map<string, StageInfo>,
  userMap: Map<string, string>
): NormalizedLead {
  const stage = lead.stage_id ? stageMap.get(lead.stage_id) : null;
  return {
    id: lead.id,
    first_name: lead.first_name,
    last_name: lead.last_name,
    email: lead.email,
    phone: lead.phone,
    city: lead.city,
    country: lead.country,
    status: lead.status,
    stage_id: lead.stage_id,
    stage_slug: stage?.slug ?? null,
    stage_name: stage?.name ?? null,
    assigned_to: lead.assigned_to,
    assigned_name: lead.assigned_to ? (userMap.get(lead.assigned_to) ?? null) : null,
    custom_fields: lead.custom_fields,
    file_urls: lead.file_urls,
    intake_source: lead.intake_source,
    intake_medium: lead.intake_medium,
    intake_campaign: lead.intake_campaign,
    preferred_contact_method: lead.preferred_contact_method,
    is_final: lead.is_final,
    created_at: lead.created_at,
    updated_at: lead.updated_at,
  };
}

/**
 * Normalize a stage row for API output.
 */
export function normalizeStage(stage: PipelineStage) {
  return {
    id: stage.id,
    slug: stage.slug,
    name: stage.name,
    position: stage.position,
    color: stage.color,
    is_default: stage.is_default,
    is_terminal: stage.is_terminal,
  };
}

// ── Integration Audit Helpers ─────────────────────────────────────

export function logIntegrationAudit(
  ctx: IntegrationRequestContext,
  action: string,
  entityType: string,
  entityId: string,
  changes?: Record<string, { old: unknown; new: unknown }>
) {
  return createAuditLog({
    tenantId: ctx.auth.tenantId,
    userId: null,
    action,
    entityType,
    entityId,
    changes,
    ipAddress: ctx.ip,
    userAgent: ctx.userAgent,
    requestId: ctx.requestId,
  });
}

export function emitIntegrationEvent(
  ctx: IntegrationRequestContext,
  type: string,
  entityType: string,
  entityId: string,
  payload?: Record<string, unknown>
) {
  // NEVER include integration_key_id or tenant_id in event payloads —
  // these are internal identifiers that must not leak to webhook consumers.
  return emitEvent({
    tenantId: ctx.auth.tenantId,
    type,
    entityType,
    entityId,
    payload: { ...payload },
    requestId: ctx.requestId,
  });
}

// ── Idempotency Helpers ───────────────────────────────────────────

/**
 * Check if an idempotency key has already been used for this tenant.
 * Returns the cached response if found, or null.
 */
export async function checkIdempotency(
  supabase: Awaited<ReturnType<typeof createServiceClient>>,
  tenantId: string,
  idempotencyKey: string
): Promise<unknown | null> {
  try {
    const { data } = await supabase
      .from("integration_idempotency")
      .select("response")
      .eq("tenant_id", tenantId)
      .eq("idempotency_key", idempotencyKey)
      .single();

    if (data) {
      return data.response as Record<string, unknown>;
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * Store an idempotency result for future deduplication.
 */
export async function storeIdempotency(
  supabase: Awaited<ReturnType<typeof createServiceClient>>,
  tenantId: string,
  idempotencyKey: string,
  endpoint: string,
  response: unknown
): Promise<void> {
  try {
    await supabase.from("integration_idempotency").upsert(
      {
        tenant_id: tenantId,
        idempotency_key: idempotencyKey,
        endpoint,
        response,
      },
      { onConflict: "tenant_id,idempotency_key" }
    );
  } catch {
    // Idempotency storage failure should not block the response
  }
}

// ── Global Error Boundary ─────────────────────────────────────────

import { apiInternalError, clearRateLimitInfo } from "@/lib/api/response";

/**
 * Wrap an integration route handler to guarantee deterministic 500 JSON responses.
 * Catches any unhandled exception and returns { error: { code: "INTERNAL_ERROR", message: "Unexpected server error" } }.
 */
export function withIntegrationErrorBoundary(
  handler: (request: NextRequest, context?: unknown) => Promise<Response>
) {
  return async (request: NextRequest, context?: unknown): Promise<Response> => {
    try {
      return await handler(request, context);
    } catch (err) {
      const log = createRequestLogger({
        requestId: crypto.randomUUID(),
        method: request.method,
        path: request.nextUrl.pathname,
        ip: getClientIp(request),
      });
      log.error({ err }, "Unhandled integration error — returning 500");
      return apiInternalError();
    } finally {
      clearRateLimitInfo();
    }
  };
}

export { createRequestLogger };
