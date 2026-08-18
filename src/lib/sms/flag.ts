import { scopedClientForTenant } from "@/lib/supabase/scoped";
import { resolveEntitlements } from "@/lib/api/entitlements";

// Environment-wide kill switch. Flag off => no SMS module code should be
// reachable from any route/job (there are none yet in Phase 1 — this flag
// exists so Phase 3+ callers have one place to check).
export function isSmsEnabled(): boolean {
  return process.env.SMS_ENABLED === "true";
}

// Inverted vs the AI flags on purpose: the safe state here must be the
// DEFAULT, because the failure mode of getting this wrong is texting real
// people. Any env that doesn't explicitly set SMS_SANDBOX=false stays
// sandboxed — every outbound send gets redirected (see env-guard.ts).
export function isSmsSandbox(): boolean {
  return process.env.SMS_SANDBOX !== "false";
}

interface TenantRow {
  plan?: string | null;
  entitlement_overrides?: Record<string, unknown> | null;
}

// Per-tenant grant, layered on top of the env kill switch. No new `tenants`
// column — reuses the existing entitlement_overrides JSONB via
// resolveEntitlements(), same mechanism as maxBranches/apiAccess etc.
export async function isSmsEnabledForTenant(tenantId: string): Promise<boolean> {
  if (!isSmsEnabled()) return false;

  const db = await scopedClientForTenant(tenantId);
  const { data } = await db
    .fromGlobal("tenants")
    .select("plan, entitlement_overrides")
    .eq("id", tenantId)
    .maybeSingle();

  if (!data) return false;
  const entitlements = resolveEntitlements(data as TenantRow) as unknown as Record<string, unknown>;
  return entitlements.sms_enabled === true;
}
