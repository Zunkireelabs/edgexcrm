import type { SupabaseClient } from "@supabase/supabase-js";

/**
 * The tenant's timezone (date filters like "Created: last 7 days" resolve in it). The board page
 * reads it from getCurrentUserTenant(); API routes read it here so both build the same index.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function getCurrentTenantTimezone(supabase: SupabaseClient<any>, tenantId: string): Promise<string> {
  const { data } = await supabase.from("tenants").select("timezone").eq("id", tenantId).maybeSingle();
  const tz = (data as { timezone?: string | null } | null)?.timezone;
  return tz || "UTC";
}
