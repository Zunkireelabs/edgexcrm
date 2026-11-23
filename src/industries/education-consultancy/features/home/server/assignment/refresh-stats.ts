import { buildUserAuthContext } from "@/lib/api/auth";
import { createServiceClient } from "@/lib/supabase/server";
import { scopedClient, scopedClientForTenant } from "@/lib/supabase/scoped";
import type { TenantConfig } from "@/types/database";
import { loadPulse } from "../../../pulse/server/load-pulse";
import { STATS_DAYS, SPEED_DAYS } from "../../lib/assignment/weights";
import { buildHomePulseContext } from "../pulse-ctx";
import { findSystemOwner } from "./assign";

/** Tenants that turned smart assignment on (shadow or auto). The one cross-tenant read, by design: it is a scheduled job. */
export async function tenantsWithAssignmentOn(): Promise<string[]> {
  const raw = await createServiceClient();
  const { data } = await raw.from("lead_assignment_settings").select("tenant_id").neq("mode", "off");
  return ((data ?? []) as unknown as Array<{ tenant_id: string }>).map((r) => r.tenant_id);
}

/**
 * Nightly, per tenant: (1) rebuild the rate stats in SQL (education_assignment_stats_refresh), (2) stamp each person's
 * Pulse 7-day flag onto their overall row via Pulse's own `loadPulse` (the scorer never recomputes Pulse). Sparse data is
 * fine: the SQL stores raw counts and the scorer smooths them (lib/assignment/weights.ts), so a tenant with 750 leads in
 * 120 days gets honest, damped rates.
 */
export async function refreshTenantStats(tenantId: string, now: Date = new Date()): Promise<{ rows: number; flagged: number }> {
  const db = await scopedClientForTenant(tenantId);
  const { data, error } = await db.raw().rpc("education_assignment_stats_refresh", { p_tenant: tenantId, p_days: STATS_DAYS, p_speed_days: SPEED_DAYS });
  if (error) throw new Error(`education_assignment_stats_refresh: ${error.message}`);
  const rows = Number(data ?? 0);

  let flagged = 0;
  const ownerId = await findSystemOwner(tenantId);
  const auth = ownerId ? await buildUserAuthContext(ownerId, tenantId) : null;
  if (auth) {
    const sdb = await scopedClient(auth);
    const { data: t } = await sdb.raw().from("tenants").select("name, timezone, config").eq("id", tenantId).single();
    const tenant = t as unknown as { name: string | null; timezone: string | null; config: TenantConfig | null } | null;
    const ctx = buildHomePulseContext(auth, sdb, tenant?.timezone ?? "Asia/Kathmandu", tenant?.config, now, null, [], tenant?.name ?? "");
    if (ctx) {
      const pulse = await loadPulse(ctx);
      for (const p of pulse.people) {
        const flag = p.flag ?? "green";
        const { error: upErr } = await sdb.from("lead_assignment_stats").update({ flag_7d: flag }).eq("user_id", p.userId).eq("destination", "*");
        if (!upErr && flag !== "green") flagged += 1;
      }
    }
  }
  return { rows, flagged };
}
