import { NextRequest } from "next/server";
import { authenticateRequest, requireAdmin } from "@/lib/api/auth";
import { createServiceClient } from "@/lib/supabase/server";
import { generateApiKey } from "@/lib/security/api-key";
import { createAuditLog } from "@/lib/api/audit";
import { checkRateLimit } from "@/lib/api/rate-limit";
import {
  apiSuccess,
  apiError,
  apiUnauthorized,
  apiForbidden,
  apiValidationError,
  apiRateLimited,
  apiInternalError,
} from "@/lib/api/response";
import { logger } from "@/lib/logger";

const VALID_SCOPES = ["read", "write", "admin"] as const;
const MAX_ACTIVE_KEYS = 20;

const KEY_CREATE_LIMIT = {
  maxRequests: 10,
  windowMs: 3600_000, // 10 per hour
};

/**
 * GET /api/v1/settings/api-keys
 * List all integration keys for the current tenant (active + revoked).
 * Never returns hashed_key.
 */
export async function GET() {
  const auth = await authenticateRequest();
  if (!auth) return apiUnauthorized();
  if (!requireAdmin(auth)) return apiForbidden();

  try {
    const supabase = await createServiceClient();
    const { data: keys, error } = await supabase
      .from("integration_keys")
      .select("id, name, permissions, created_at, last_used_at, revoked_at")
      .eq("tenant_id", auth.tenantId)
      .order("created_at", { ascending: false });

    if (error) {
      logger.error({ err: error }, "Failed to list integration keys");
      return apiInternalError();
    }

    const result = (keys || []).map((k) => ({
      id: k.id,
      name: k.name,
      permissions: k.permissions,
      created_at: k.created_at,
      last_used_at: k.last_used_at,
      revoked_at: k.revoked_at,
      status: k.revoked_at ? "revoked" : "active",
    }));

    return apiSuccess(result);
  } catch (err) {
    logger.error({ err }, "Error listing integration keys");
    return apiInternalError();
  }
}

/**
 * POST /api/v1/settings/api-keys
 * Create a new integration key. Returns the raw key exactly once.
 */
export async function POST(request: NextRequest) {
  const auth = await authenticateRequest();
  if (!auth) return apiUnauthorized();
  if (!requireAdmin(auth)) return apiForbidden();

  // Rate limit key creation
  const rateResult = await checkRateLimit(
    `api_key_create:${auth.tenantId}`,
    KEY_CREATE_LIMIT
  );
  if (!rateResult.allowed) {
    return apiRateLimited(rateResult.retryAfterSeconds);
  }

  let body: { name?: string; scope?: string };
  try {
    body = await request.json();
  } catch {
    return apiValidationError({ body: ["Invalid JSON"] });
  }

  // Validate name
  const name = typeof body.name === "string" ? body.name.trim() : "";
  if (!name || name.length < 1 || name.length > 100) {
    return apiValidationError({
      name: ["Name is required (1-100 characters)"],
    });
  }

  // Validate scope
  const scope = body.scope as (typeof VALID_SCOPES)[number];
  if (!VALID_SCOPES.includes(scope)) {
    return apiValidationError({
      scope: [`Scope must be one of: ${VALID_SCOPES.join(", ")}`],
    });
  }

  try {
    const supabase = await createServiceClient();

    // Check tenant is not suspended
    const { data: tenant } = await supabase
      .from("tenants")
      .select("id, config")
      .eq("id", auth.tenantId)
      .single();

    if (!tenant) {
      return apiError("TENANT_NOT_FOUND", "Tenant not found", 404);
    }

    const tenantConfig = (tenant.config || {}) as Record<string, unknown>;
    if (tenantConfig.suspended === true) {
      return apiError(
        "TENANT_SUSPENDED",
        "Cannot create API keys while tenant is suspended",
        403
      );
    }

    // Enforce max active keys limit
    const { count, error: countError } = await supabase
      .from("integration_keys")
      .select("id", { count: "exact", head: true })
      .eq("tenant_id", auth.tenantId)
      .is("revoked_at", null);

    if (countError) {
      logger.error({ err: countError }, "Failed to count active keys");
      return apiInternalError();
    }

    if ((count ?? 0) >= MAX_ACTIVE_KEYS) {
      return apiError(
        "KEY_LIMIT_REACHED",
        `Maximum of ${MAX_ACTIVE_KEYS} active API keys allowed. Revoke unused keys first.`,
        409
      );
    }

    // Generate key
    const { rawKey, hashedKey } = generateApiKey();

    const { data: created, error: insertError } = await supabase
      .from("integration_keys")
      .insert({
        tenant_id: auth.tenantId,
        name,
        hashed_key: hashedKey,
        permissions: [scope],
      })
      .select("id, name, permissions, created_at")
      .single();

    if (insertError) {
      logger.error({ err: insertError }, "Failed to create integration key");
      return apiInternalError();
    }

    // Audit log
    await createAuditLog({
      tenantId: auth.tenantId,
      userId: auth.userId,
      action: "integration_key.created",
      entityType: "integration_key",
      entityId: created.id,
      changes: { name: { old: null, new: name }, scope: { old: null, new: scope } },
    });

    return apiSuccess(
      {
        id: created.id,
        name: created.name,
        scope,
        key: rawKey, // Shown once, never again
        created_at: created.created_at,
      },
      201
    );
  } catch (err) {
    logger.error({ err }, "Error creating integration key");
    return apiInternalError();
  }
}
