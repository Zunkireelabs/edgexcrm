import type { AuthContext } from "@/lib/api/auth";
import { getBranches } from "@/lib/supabase/queries";
import { scopedClient } from "@/lib/supabase/scoped";
import { MODELS, ACTIVE_PROVIDER } from "@/lib/ai/models";
import type { TenantConfig } from "@/types/database";
import { homeOverBudget, recordHomeUsage } from "../ai/usage";
import { writeRead } from "../ai/orca-read";
import { counsellorFacts, managerFacts, fillerFlaws, pluralFlaws, validatePoints, type Fact, type ReadPoint, type ReadScope } from "../lib/orca-read";
import { leadsOfPersonHref } from "../../pulse/lib/leads-links";
import { resolveHomeScope, type HomeScope } from "../lib/scope";
import { localDate } from "../lib/time";
import type { StoredRead } from "./stored-read";
import { loadHome } from "./load-page";
import { loadManagerHome } from "./load-manager";

/** Which read this person gets (counsellor "me" or owner/manager "business"), without loading any Home data. */
export async function resolveReadScope(auth: AuthContext, tenantId: string, cookieBranch: string | null): Promise<{ scope: ReadScope; home: HomeScope }> {
  const branchRows = await getBranches(tenantId);
  const home = resolveHomeScope(auth.permissions, auth.userId, auth.branchId, cookieBranch, branchRows.map((b) => b.id));
  return { scope: home.mode === "manager" ? "business" : "me", home };
}

/** The facts for one person, from the SAME loaders Home renders from (so Home and its read can never disagree). */
export async function buildReadFacts(
  auth: AuthContext,
  tenant: { name: string | null; timezone: string | null; config: TenantConfig | null },
  home: HomeScope,
  now: Date,
): Promise<Fact[]> {
  const info = { timezone: tenant.timezone, config: tenant.config };
  if (home.mode === "manager") {
    const data = await loadManagerHome(auth, { name: tenant.name, ...info }, home, "", now);
    return managerFacts(data.needsYou, data.needsALook, data.impact.status === "ready" ? data.impact.rows : [], data.canOpenPulse, (id) => leadsOfPersonHref(id));
  }
  const data = await loadHome(auth, info, "", now, { withRead: false });
  return counsellorFacts(data.doNext.items, data.week);
}

export type MakeReadResult = { kind: "made"; read: StoredRead } | { kind: "paused" } | { kind: "failed" };

/**
 * Writes today's read for this person (insert, or replace on a refresh). Over budget: "paused". Provider failure or timeout:
 * "failed", nothing stored, the rule-based Home stays. No facts, or nothing worth saying: an EMPTY read is stored so it is
 * not remade on every load, and the card does not show.
 */
export async function makeRead(p: {
  auth: AuthContext;
  scope: ReadScope;
  facts: Fact[];
  tz: string;
  now: Date;
  refreshes: number;
  /** A real open by the person (a job-made row leaves opened_at empty, so it never counts as "active"). */
  opened: boolean;
}): Promise<MakeReadResult> {
  const db = await scopedClient(p.auth);
  if (await homeOverBudget(db, p.auth.tenantId)) return { kind: "paused" };
  const forDate = localDate(p.now, p.tz);
  const runId = crypto.randomUUID();

  let points: ReadPoint[] = [];
  if (p.facts.length > 0) {
    try {
      const first = await writeRead(p.scope, p.facts, forDate);
      await recordHomeUsage(db, { surface: "home_read", kind: "agent", userId: p.auth.userId, runId, usage: first.usage }).catch(() => {});
      points = validatePoints(first.points, p.facts);
      // Q11: "1 leads" is a wrong count. Retry ONCE telling the model exactly what was wrong (as the drafts do); a point that is still wrong is dropped, never repaired.
      // B9: banned filler words get the same one retry, naming the exact words (checked on the raw points, since validatePoints drops them).
      const flawed = pluralFlaws(...points.flatMap((x) => [x.claim, x.reason]));
      const filler = fillerFlaws(...first.points.flatMap((x) => [x.claim, x.reason]));
      const fix = [
        ...(flawed.length ? [`wrong count words: ${flawed.map((f) => `'${f}'`).join(", ")}; write '1 lead', '2 leads', '1 call', '3 calls'`] : []),
        ...(filler.length ? [`banned filler words: ${filler.map((f) => `'${f}'`).join(", ")}; state the plain fact with its number, no 'indicating' or 'significant'`] : []),
      ];
      if (fix.length) {
        const again = await writeRead(p.scope, p.facts, forDate, fix);
        await recordHomeUsage(db, { surface: "home_read", kind: "agent", userId: p.auth.userId, runId, usage: again.usage }).catch(() => {});
        points = validatePoints(again.points, p.facts);
      }
      points = points.filter((x) => pluralFlaws(x.claim, x.reason).length === 0);
    } catch {
      return { kind: "failed" };
    }
  }
  const madeAt = p.now.toISOString();
  const { error } = await db.from("home_reads").upsert(
    {
      user_id: p.auth.userId,
      scope: p.scope,
      for_date: forDate,
      points,
      made_at: madeAt,
      model: MODELS[ACTIVE_PROVIDER].agent,
      refreshes: p.refreshes,
      feedback: null,
      feedback_at: null,
      ...(p.opened ? { opened_at: madeAt } : {}),
    },
    { onConflict: "tenant_id,user_id,scope,for_date" },
  );
  if (error) return { kind: "failed" };
  return { kind: "made", read: { points, madeAt, refreshes: p.refreshes, feedback: null } };
}
