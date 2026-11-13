import { createServiceClient } from "@/lib/supabase/server";
import { scopedClientForTenant } from "@/lib/supabase/scoped";
import { fetchProcessMetrics } from "./load-processes";
import type { ProcessKey } from "../lib/keys";

export const SNAPSHOT_WINDOW_DAYS = 30;

/** Tenant-local calendar day (YYYY-MM-DD). */
export const localDay = (now: Date, tz: string): string => new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(now);

/** Tenants that have processes. The one cross-tenant read, by design: it is a scheduled job. */
export async function tenantsWithProcesses(): Promise<string[]> {
  const raw = await createServiceClient();
  const { data } = await raw.from("processes").select("tenant_id");
  return [...new Set(((data ?? []) as unknown as Array<{ tenant_id: string }>).map((r) => r.tenant_id))];
}

/**
 * Write today's metrics row for every process of one tenant (live version id when there is one). Idempotent per day: the row is keyed
 * (process_id, day), so a rerun the same day REPLACES that day's row instead of adding one.
 */
export async function snapshotTenant(tenantId: string, now: Date = new Date()): Promise<{ written: number; skipped: number }> {
  const db = await scopedClientForTenant(tenantId);
  const { data: t } = await db.raw().from("tenants").select("timezone").eq("id", tenantId).single();
  const tz = (t as unknown as { timezone: string | null } | null)?.timezone ?? "Asia/Kathmandu";
  const { data: procs } = await db.from("processes").select("id, key, live_version_id");
  const day = localDay(now, tz);
  const from = new Date(now.getTime() - SNAPSHOT_WINDOW_DAYS * 86_400_000);
  let written = 0;
  let skipped = 0;
  for (const p of (procs ?? []) as unknown as Array<{ id: string; key: ProcessKey; live_version_id: string | null }>) {
    const metrics = await fetchProcessMetrics(db, tenantId, p.key, from, now, tz);
    if (!metrics) {
      skipped++;
      continue;
    }
    // Explicit tenant_id on the raw client: the table's PK is (process_id, day), not tenant-prefixed, so the scoped upsert guard doesn't fit.
    const { error } = await db.raw().from("process_metric_snapshots").upsert(
      { tenant_id: tenantId, process_id: p.id, version_id: p.live_version_id, day, metrics },
      { onConflict: "process_id,day" },
    );
    if (error) throw new Error(`process_metric_snapshots upsert: ${error.message}`);
    written++;
  }
  return { written, skipped };
}
