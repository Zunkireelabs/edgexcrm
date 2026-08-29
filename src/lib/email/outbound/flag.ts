import { scopedClientForTenant } from "@/lib/supabase/scoped";

// Environment-wide kill switch. Default OFF — mirrors src/lib/sms/flag.ts.
export function isEmailOutboundEnabled(): boolean {
  return process.env.EMAIL_OUTBOUND_ENABLED === "true";
}

// INVERTED on purpose, exactly like isSmsSandbox(): the safe state must be the
// DEFAULT, because the failure mode of getting this wrong is mailing 16,684
// real students. Any env that does not explicitly set EMAIL_OUTBOUND_SANDBOX=false
// stays sandboxed (see env-guard.ts).
export function isEmailOutboundSandbox(): boolean {
  return process.env.EMAIL_OUTBOUND_SANDBOX !== "false";
}

interface TenantEmailSettingsRow {
  bulk_email_enabled?: boolean | null;
}

// Per-tenant grant, layered on top of the env kill switch. Reads
// tenant_email_settings.bulk_email_enabled directly — a real column, not an
// entitlement_overrides key, because tenant_email_settings already exists and
// is where every other sending decision for a tenant lives (§4.1 brief).
export async function isBulkEmailEnabledForTenant(tenantId: string): Promise<boolean> {
  if (!isEmailOutboundEnabled()) return false;

  const db = await scopedClientForTenant(tenantId);
  const { data } = await db
    .from("tenant_email_settings")
    .select("bulk_email_enabled")
    .maybeSingle();

  return (data as TenantEmailSettingsRow | null)?.bulk_email_enabled === true;
}
