import { buildUserAuthContext } from "@/lib/api/auth";
import { createServiceClient } from "@/lib/supabase/server";
import { isAssistantEnabled } from "@/lib/ai/flag";
import type { TenantConfig } from "@/types/database";
import { ACTIVE_DAYS, isMorningSlot, pairsToMake, type ReadRowLite } from "../lib/morning";
import { buildReadFacts, makeRead, resolveReadScope } from "./orca-read";

/**
 * Education tenants with AI on (the env switch AND tenants.ai_enabled): the one cross-tenant read, by design, because it is a
 * scheduled job. With the env switch off this returns [] without touching the database.
 */
export async function tenantsForMorningReads(): Promise<string[]> {
  if (!isAssistantEnabled()) return [];
  const raw = await createServiceClient();
  const { data } = await raw.from("tenants").select("id").eq("industry_id", "education_consultancy").eq("ai_enabled", true);
  return ((data ?? []) as unknown as Array<{ id: string }>).map((r) => r.id);
}

export interface MorningResult {
  skipped?: "not the morning hour" | "no tenant";
  made: number;
  failed: number;
  /** Branch managers pinned to a branch read through their own session: made on their first open instead. */
  needsSession: number;
  paused: boolean;
}

export async function runMorningReadsForTenant(tenantId: string, now: Date = new Date()): Promise<MorningResult> {
  const result: MorningResult = { made: 0, failed: 0, needsSession: 0, paused: false };
  const raw = await createServiceClient();
  const { data: t } = await raw.from("tenants").select("name, timezone, config").eq("id", tenantId).single();
  const tenant = t as unknown as { name: string | null; timezone: string | null; config: TenantConfig | null } | null;
  if (!tenant) return { ...result, skipped: "no tenant" };
  const tz = tenant.timezone ?? "Asia/Kathmandu";
  if (!isMorningSlot(now, tz)) return { ...result, skipped: "not the morning hour" };

  const since = new Date(now.getTime() - (ACTIVE_DAYS + 1) * 86_400_000).toISOString();
  const { data: rows } = await raw.from("home_reads").select("user_id, scope, for_date, opened_at").eq("tenant_id", tenantId).gte("made_at", since);
  const todo = pairsToMake((rows ?? []) as unknown as ReadRowLite[], now, tz);

  for (const p of todo) {
    try {
      const auth = await buildUserAuthContext(p.userId, tenantId);
      if (!auth) continue;
      const { scope, home } = await resolveReadScope(auth, tenantId, null);
      if (scope !== p.scope) continue; // their role changed since they last opened Home
      if (home.mode === "manager" && home.pinned) {
        result.needsSession++;
        continue;
      }
      const facts = await buildReadFacts(auth, tenant, home, now);
      const r = await makeRead({ auth, scope, facts, tz, now, refreshes: 0, opened: false });
      if (r.kind === "paused") {
        result.paused = true;
        break;
      }
      if (r.kind === "made") result.made++;
      else result.failed++;
    } catch {
      result.failed++;
    }
  }
  return result;
}
