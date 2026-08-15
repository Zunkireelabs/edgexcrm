import type { ScopedClient } from "@/lib/supabase/scoped";
import { DEFAULT_TENANT_SMS_SETTINGS, type TenantSmsSettingsRow } from "./compose";

// tenant_sms_settings is optional-per-tenant (row created lazily on first
// PATCH) — every reader falls back to DEFAULT_TENANT_SMS_SETTINGS rather than
// requiring a row to exist. Timezone resolution order per SMS-PHASE3A-BRIEF.md
// §5: tenant_sms_settings.timezone -> tenants.timezone -> 'Asia/Kathmandu'.

export async function loadTenantSmsSettings(db: ScopedClient): Promise<TenantSmsSettingsRow> {
  const { data } = await db.from("tenant_sms_settings").select("*").maybeSingle();
  const row = data as Partial<TenantSmsSettingsRow> | null;
  if (!row) return { ...DEFAULT_TENANT_SMS_SETTINGS };
  return { ...DEFAULT_TENANT_SMS_SETTINGS, ...row };
}

export async function resolveTenantTimezone(db: ScopedClient, tenantId: string, settingsTimezone: string | null): Promise<string> {
  if (settingsTimezone) return settingsTimezone;
  const { data } = await db.fromGlobal("tenants").select("timezone").eq("id", tenantId).maybeSingle();
  return (data as { timezone?: string } | null)?.timezone || "Asia/Kathmandu";
}
