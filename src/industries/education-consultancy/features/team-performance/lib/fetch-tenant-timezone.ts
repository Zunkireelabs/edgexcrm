import type { scopedClient } from "@/lib/supabase/scoped";

/** Shared by every window-scoped team-performance route (relay/leakage). */
export async function fetchTenantTimezone(
  db: Awaited<ReturnType<typeof scopedClient>>,
  tenantId: string,
): Promise<string | null> {
  const { data } = await db.raw().from("tenants").select("timezone").eq("id", tenantId).single();
  return (data as unknown as { timezone: string } | null)?.timezone ?? null;
}
