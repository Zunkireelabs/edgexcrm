import type { PulseContext } from "./context";
import { windowLengthMs } from "../lib/window";
import type { CoverageInput } from "../lib/coverage";

/**
 * The tenant's first activity record (calls/notes/status changes) — the earliest a "usual" can start. Two
 * one-row index lookups; null when the tenant has no activity at all.
 */
export async function loadTenantFirstActivity(ctx: PulseContext): Promise<Date | null> {
  const { db, auth } = ctx;
  const first = async (table: "lead_activities" | "audit_logs") => {
    const { data } = await db.raw().from(table).select("created_at").eq("tenant_id", auth.tenantId).order("created_at", { ascending: true }).limit(1);
    const at = (data as unknown as Array<{ created_at: string }> | null)?.[0]?.created_at;
    return at ? new Date(at) : null;
  };
  const [a, b] = await Promise.all([first("lead_activities"), first("audit_logs")]);
  const all = [a, b].filter((d): d is Date => !!d);
  return all.length ? new Date(Math.min(...all.map((d) => d.getTime()))) : null;
}

export async function loadCoverage(ctx: PulseContext): Promise<CoverageInput> {
  return { windowFrom: ctx.window.from, lenMs: windowLengthMs(ctx.window), tenantFirst: await loadTenantFirstActivity(ctx) };
}
