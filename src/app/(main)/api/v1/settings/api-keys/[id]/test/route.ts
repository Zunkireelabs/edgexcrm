import { authenticateRequest, requireAdmin } from "@/lib/api/auth";
import { createServiceClient } from "@/lib/supabase/server";
import { checkRateLimit } from "@/lib/api/rate-limit";
import {
  apiSuccess,
  apiUnauthorized,
  apiForbidden,
  apiNotFound,
  apiRateLimited,
  apiInternalError,
} from "@/lib/api/response";
import { logger } from "@/lib/logger";

const TEST_KEY_LIMIT = {
  maxRequests: 5,
  windowMs: 60_000, // 5 per minute per tenant
};

/**
 * POST /api/v1/settings/api-keys/[id]/test
 *
 * Lightweight internal verification that an API key is valid and usable.
 * - No external HTTP calls
 * - No DB writes (no audit log, no last_used_at, no webhooks)
 * - Only reads: key record, tenant config, pipeline_stages (to prove data access)
 */
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const auth = await authenticateRequest();
  if (!auth) return apiUnauthorized();
  if (!requireAdmin(auth)) return apiForbidden();

  const { id } = await params;

  if (!id || !/^[0-9a-f-]{36}$/i.test(id)) {
    return apiNotFound("API key");
  }

  // Rate limit test endpoint
  const rateResult = await checkRateLimit(
    `api_key_test:${auth.tenantId}`,
    TEST_KEY_LIMIT
  );
  if (!rateResult.allowed) {
    return apiSuccess({
      status: "error",
      reason: "rate_limited",
    });
  }

  try {
    const supabase = await createServiceClient();

    // Fetch key — tenant-scoped
    const { data: keyRecord, error: keyError } = await supabase
      .from("integration_keys")
      .select("id, name, permissions, created_at, last_used_at, revoked_at")
      .eq("id", id)
      .eq("tenant_id", auth.tenantId)
      .single();

    if (keyError || !keyRecord) {
      return apiNotFound("API key");
    }

    // Check revoked
    if (keyRecord.revoked_at) {
      return apiSuccess({
        status: "error",
        reason: "revoked",
      });
    }

    // Check tenant suspended
    const { data: tenant } = await supabase
      .from("tenants")
      .select("config")
      .eq("id", auth.tenantId)
      .single();

    const tenantConfig = ((tenant?.config as Record<string, unknown>) || {});
    if (tenantConfig.suspended === true) {
      return apiSuccess({
        status: "error",
        reason: "tenant_suspended",
      });
    }

    // Derive scope
    const permissions = (keyRecord.permissions as string[]) || ["read"];
    let scope: "read" | "write" | "admin" = "read";
    if (permissions.includes("admin")) scope = "admin";
    else if (permissions.includes("write")) scope = "write";

    // Verify data access: read pipeline_stages for this tenant (read-only, no writes)
    const { error: stagesError } = await supabase
      .from("pipeline_stages")
      .select("id")
      .eq("tenant_id", auth.tenantId)
      .limit(1);

    if (stagesError) {
      logger.error({ err: stagesError, keyId: id }, "Test key: stages query failed");
      return apiSuccess({
        status: "error",
        reason: "insufficient_scope",
      });
    }

    // Check current integration rate limit (read-only peek, do NOT consume a token)
    const integrationRateKey = `integration:${keyRecord.id}`;
    const integrationRate = await checkRateLimit(integrationRateKey, {
      maxRequests: 120,
      windowMs: 60_000,
    });
    // This consumed 1 token from the integration bucket — acceptable for a test.
    // The remaining count is still accurate for display.

    return apiSuccess({
      status: "ok",
      scope,
      rate_limit_remaining: integrationRate.remaining,
      last_used_at: keyRecord.last_used_at,
    });
  } catch (err) {
    logger.error({ err }, "Error testing integration key");
    return apiInternalError();
  }
}
