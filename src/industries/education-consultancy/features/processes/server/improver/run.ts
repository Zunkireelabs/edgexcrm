import { buildAgentAuthContext } from "@/lib/ai/agent-auth";
import { runAgent, type RunAgentResult } from "@/lib/ai/agents/runtime";
import "@/lib/ai/agents/packs"; // module-load registration — must run before getAgentDefinition()
import { getAgentDefinition } from "@/lib/ai/agents/registry";
import { logger } from "@/lib/logger";
import { createServiceClient } from "@/lib/supabase/server";
import { scopedClientForTenant } from "@/lib/supabase/scoped";
import { INDUSTRIES } from "@/industries/_registry";
import { must } from "../changes";
import type { ProcessesDb } from "../context";
import { AGED_EVENT, IMPROVER_EVENT } from "./tools";
import { loadImproverContext } from "./context";
import { isOldEnoughForRead, PROCESS_READ_KIND } from "./read-store";

/**
 * Orchestration for the Process Improver (EDGEX-109 P4a): who runs when, and the plan for each tenant. The Inngest functions in
 * `src/lib/inngest/functions/process-improver.ts` are thin; this file holds the decisions so they are testable.
 *
 * Every plan step is conservative and quiet (decision 11): anything unexpected means "no run for this process", a log line, and the live
 * process keeps running Home and assignment exactly as before.
 */

export const IMPROVER_KEY = "process-improver";
export const WEEKLY_DAY = 6; // Saturday
export const WEEKLY_HOUR = 20; // 20:00 tenant time
const DAY = 86_400_000;

export interface ImproverTenant {
  tenantId: string;
  tz: string;
}

/** Education tenants with the per-tenant AI grant (`ai_enabled`). The one cross-tenant read, by design: it is a scheduled job. */
export async function listImproverTenants(): Promise<ImproverTenant[]> {
  const raw = await createServiceClient();
  const { data, error } = await raw.from("tenants").select("id, timezone").eq("industry_id", INDUSTRIES.EDUCATION_CONSULTANCY).eq("ai_enabled", true);
  if (error) throw error; // fail closed: Inngest retries the step
  return ((data ?? []) as unknown as Array<{ id: string; timezone: string | null }>).map((t) => ({ tenantId: t.id, tz: t.timezone ?? "Asia/Kathmandu" }));
}

/** Is it Saturday 20:00-20:59 where the tenant is? (The cron fires hourly Friday to Sunday UTC, so every timezone gets its hour.) */
export function isWeeklyHour(now: Date, tz: string): boolean {
  const weekday = new Intl.DateTimeFormat("en-US", { timeZone: tz, weekday: "short" }).format(now);
  const hour = Number(new Intl.DateTimeFormat("en-GB", { timeZone: tz, hour: "2-digit", hourCycle: "h23" }).format(now));
  return weekday === "Sat" && hour === WEEKLY_HOUR;
}

/**
 * The identity Orca runs as, created on its first run for the tenant (decision 3: on by default). An existing identity is respected:
 * paused (the Fleet off-switch) means no run at all. Returns null when there is nothing to run as.
 */
export async function ensureImproverIdentity(tenantId: string): Promise<string | null> {
  const db = await scopedClientForTenant(tenantId);
  const existing = must("agent identity read", await db.from("agent_identities").select("id, status").eq("agent_key", IMPROVER_KEY).maybeSingle()) as unknown as { id: string; status: string } | null;
  if (existing) return existing.status === "active" ? existing.id : null;
  const res = await db.from("agent_identities").insert({ agent_key: IMPROVER_KEY, display_name: "Orca", status: "active" }).select("id").single();
  if (res.error?.code === "23505") {
    // A concurrent first run created it: read it back.
    const again = must("agent identity read", await db.from("agent_identities").select("id, status").eq("agent_key", IMPROVER_KEY).maybeSingle()) as unknown as { id: string; status: string } | null;
    return again && again.status === "active" ? again.id : null;
  }
  if (res.error) throw new Error(`agent identity insert: ${res.error.message}`);
  return (res.data as unknown as { id: string }).id;
}

export interface PlannedRun {
  processId: string;
  key: string;
}

/** Has Orca already run this event for this subject within `days`? (Weekly runs must not repeat; a rerun the same hour is a no-op.) */
async function ranRecently(db: ProcessesDb, agentId: string, event: string, subjectId: string, now: Date, days: number): Promise<boolean> {
  const rows = must("agent runs read", await db.from("agent_runs").select("id").eq("agent_id", agentId).eq("trigger_event", event).eq("subject_id", subjectId).gte("started_at", new Date(now.getTime() - days * DAY).toISOString()).limit(1)) as unknown as unknown[] | null;
  return (rows?.length ?? 0) > 0;
}

/**
 * The processes worth a weekly run: a live version, no open draft (Orca waits while any draft is open, a person's or its own), not on
 * target (nothing to improve), and not already run this week. Checking before the model saves the whole run's cost.
 */
export async function planWeeklyRuns(db: ProcessesDb, tenantId: string, agentId: string, now: Date): Promise<PlannedRun[]> {
  const procs = (must("processes read", await db.from("processes").select("id, key, live_version_id")) as unknown as Array<{ id: string; key: string; live_version_id: string | null }> | null) ?? [];
  const out: PlannedRun[] = [];
  for (const p of procs) {
    if (!p.live_version_id) continue;
    const draft = must("draft read", await db.from("process_versions").select("id").eq("process_id", p.id).eq("status", "draft").limit(1)) as unknown as unknown[] | null;
    if ((draft?.length ?? 0) > 0) continue;
    if (await ranRecently(db, agentId, IMPROVER_EVENT, p.id, now, 6)) continue;
    const c = await loadImproverContext(db, tenantId, p.id, now);
    if (!c || !c.live || !c.rawNow || c.onTarget || c.steps.length === 0) continue;
    out.push({ processId: p.id, key: p.key });
  }
  return out;
}

/** Live versions that are 7+ days old and have no read yet: each gets its first "Orca's read". */
export async function planReadRuns(db: ProcessesDb, agentId: string, now: Date): Promise<Array<{ processId: string; versionId: string }>> {
  const procs = (must("processes read", await db.from("processes").select("id, live_version_id")) as unknown as Array<{ id: string; live_version_id: string | null }> | null) ?? [];
  const out: Array<{ processId: string; versionId: string }> = [];
  for (const p of procs) {
    if (!p.live_version_id) continue;
    const v = must("live version read", await db.from("process_versions").select("approved_at, version").eq("id", p.live_version_id).maybeSingle()) as unknown as { approved_at: string | null; version: number } | null;
    if (!v || v.version < 2 || !isOldEnoughForRead(v.approved_at, now)) continue; // v1 is the baseline: no before -> after to read
    const have = must("read check", await db.from("agent_outputs").select("id").eq("kind", PROCESS_READ_KIND).eq("subject_type", "process_version").eq("subject_id", p.live_version_id).limit(1)) as unknown as unknown[] | null;
    if ((have?.length ?? 0) > 0) continue;
    if (await ranRecently(db, agentId, AGED_EVENT, p.id, now, 1)) continue; // tried today already (e.g. the model chose not to write): try again tomorrow
    out.push({ processId: p.id, versionId: p.live_version_id });
  }
  return out;
}

/** One run for one process. Never throws: a failed run is a log line and no draft. */
export async function runImprover(tenantId: string, agentId: string, event: string, processId: string): Promise<RunAgentResult | { status: "skipped"; reason: string }> {
  try {
    const def = getAgentDefinition(IMPROVER_KEY);
    if (!def) return { status: "skipped", reason: "agent definition not registered" };
    const auth = await buildAgentAuthContext(agentId, tenantId);
    if (!auth) return { status: "skipped", reason: "agent identity vanished" };
    return await runAgent(def, auth, { event, subjectType: "process", subjectId: processId });
  } catch (e) {
    logger.error({ err: e, tenantId, processId, event }, "process improver run failed");
    return { status: "skipped", reason: "run failed" };
  }
}

