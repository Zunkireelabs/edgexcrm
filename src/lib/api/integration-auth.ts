import { createServiceClient } from "@/lib/supabase/server";
import { hashApiKey, verifyApiKeyHash } from "@/lib/security/api-key";
import { createAuditLog } from "@/lib/api/audit";
import { getClientIp } from "@/lib/api/auth";
import { logger } from "@/lib/logger";

export interface IntegrationAuthContext {
  tenantId: string;
  integrationKeyId: string;
  permissions: string[];
}

export type IntegrationAuthResult =
  | {
      success: true;
      context: IntegrationAuthContext;
    }
  | {
      success: false;
      status: number;
      error: string;
    };

/**
 * Authenticate an integration request using API key (Bearer token).
 * Completely separate from Supabase JWT auth — does NOT use cookies or sessions.
 */
export async function authenticateIntegrationRequest(
  request: Request
): Promise<IntegrationAuthResult> {
  const authHeader = request.headers.get("authorization");

  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    await logAuthFailure(request, "missing_header");
    return {
      success: false,
      status: 401,
      error: "Missing or invalid Authorization header",
    };
  }

  const rawKey = authHeader.slice(7); // Strip "Bearer "

  if (!rawKey || rawKey.length < 10) {
    await logAuthFailure(request, "invalid_key_format");
    return {
      success: false,
      status: 401,
      error: "Invalid API key format",
    };
  }

  const candidateHash = hashApiKey(rawKey);

  try {
    const supabase = await createServiceClient();

    // Lookup by hashed key — service role bypasses RLS
    const { data: keyRecord, error } = await supabase
      .from("integration_keys")
      .select("id, tenant_id, hashed_key, permissions, revoked_at, last_used_at")
      .eq("hashed_key", candidateHash)
      .is("revoked_at", null)
      .single();

    if (error || !keyRecord) {
      await logAuthFailure(request, "key_not_found");
      return {
        success: false,
        status: 401,
        error: "Invalid or revoked API key",
      };
    }

    // Constant-time verification
    if (!verifyApiKeyHash(candidateHash, keyRecord.hashed_key)) {
      await logAuthFailure(request, "hash_mismatch");
      return {
        success: false,
        status: 401,
        error: "Invalid or revoked API key",
      };
    }

    const context: IntegrationAuthContext = {
      tenantId: keyRecord.tenant_id,
      integrationKeyId: keyRecord.id,
      permissions: (keyRecord.permissions as string[]) || ["read"],
    };

    // Log successful auth
    await createAuditLog({
      tenantId: context.tenantId,
      userId: null,
      action: "integration.auth.success",
      entityType: "integration_key",
      entityId: context.integrationKeyId,
      ipAddress: getClientIp(request),
      userAgent: request.headers.get("user-agent"),
    });

    // Throttled last_used_at update — only if >60s since last update
    updateLastUsedThrottled(
      supabase,
      keyRecord.id,
      keyRecord.last_used_at as string | null
    );

    return { success: true, context };
  } catch (err) {
    logger.error({ err }, "Integration auth error");
    await logAuthFailure(request, "internal_error");
    return {
      success: false,
      status: 401,
      error: "Authentication failed",
    };
  }
}

const LAST_USED_THROTTLE_MS = 60_000; // 60 seconds

/**
 * Non-blocking, throttled update of last_used_at.
 * Only writes if the stored value is null or older than 60 seconds.
 * Fire-and-forget — never blocks the auth response.
 */
function updateLastUsedThrottled(
  supabase: Awaited<ReturnType<typeof createServiceClient>>,
  keyId: string,
  lastUsedAt: string | null
): void {
  const now = Date.now();
  const lastUsed = lastUsedAt ? new Date(lastUsedAt).getTime() : 0;

  if (now - lastUsed < LAST_USED_THROTTLE_MS) return;

  supabase
    .from("integration_keys")
    .update({ last_used_at: new Date(now).toISOString() })
    .eq("id", keyId)
    .then(({ error }) => {
      if (error) {
        logger.error({ err: error, keyId }, "Failed to update last_used_at");
      }
    });
}

async function logAuthFailure(request: Request, reason: string): Promise<void> {
  try {
    await createAuditLog({
      tenantId: "00000000-0000-0000-0000-000000000000",
      userId: null,
      action: "integration.auth.failed",
      entityType: "integration_key",
      entityId: "unknown",
      changes: { reason: { old: null, new: reason } },
      ipAddress: getClientIp(request),
      userAgent: request.headers.get("user-agent"),
    });
  } catch {
    // Audit logging failure should not block auth response
  }
}
