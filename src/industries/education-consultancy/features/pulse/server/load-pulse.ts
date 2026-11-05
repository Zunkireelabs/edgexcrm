import { assemblePeople } from "../lib/assemble";
import { quietSinceDay } from "../lib/quiet";
import { coveredUsualIndices, previousCovered as prevCovered, MIN_COVERED_WINDOWS } from "../lib/coverage";
import { loadCoverage } from "./coverage";
import { normalizePosition } from "../lib/positions";
import { rollups } from "../lib/rollup";
import { buildAttention } from "../lib/attention";
import { buildBriefing } from "../lib/briefing";
import { isAssistantEnabledForTenant } from "@/lib/ai/flag";
import { computeSignals } from "../lib/signals";
import { mean } from "../lib/window";
import {
  activityOf,
  type BranchKpi,
  type LeakReason,
  type PersonBucketRow,
  type PersonInfo,
  type PulseFunnelStage,
  type PulseQuality,
  type PulseResponse,
  type StageFlow,
} from "../lib/types";
import { loadUserNames, type PulseContext } from "./context";

interface TenantUserRow {
  user_id: string;
  created_at: string | null;
  role: string;
  branch_id: string | null;
  suspended_at: string | null;
  positions: { name: string | null; slug: string | null } | Array<{ name: string | null; slug: string | null }> | null;
}

/** Everyone the scoreboard can show: active members with a position, plus anyone with activity in the span. */
export async function loadPeople(ctx: PulseContext, activeIds: Set<string>): Promise<PersonInfo[]> {
  const { db, branchId, branches } = ctx;
  const { data } = await db
    .from("tenant_users")
    .select("user_id, created_at, role, branch_id, suspended_at, positions(name, slug)");
  const names = await loadUserNames(db);
  const branchName = new Map(branches.map((b) => [b.id, b.name]));
  const out: PersonInfo[] = [];
  for (const m of (data ?? []) as unknown as TenantUserRow[]) {
    if (branchId && m.branch_id !== branchId) continue;
    const pos = Array.isArray(m.positions) ? m.positions[0] : m.positions;
    const hasPosition = !!pos?.slug;
    if (m.suspended_at && !activeIds.has(m.user_id)) continue;
    // Owners/admins without a position or activity are not "team" — keep the scoreboard to people who do the work.
    if (!hasPosition && !activeIds.has(m.user_id)) continue;
    const u = names.get(m.user_id);
    out.push({
      userId: m.user_id,
      name: u?.name ?? "Unknown",
      email: u?.email ?? null,
      positionSlug: pos?.slug ?? null,
      positionName: pos?.name ?? null,
      positionKey: normalizePosition(pos?.slug, pos?.name).key,
      positionLabel: normalizePosition(pos?.slug, pos?.name).label,
      branchId: m.branch_id,
      branchName: m.branch_id ? (branchName.get(m.branch_id) ?? null) : null,
      joinedAt: m.created_at,
    });
  }
  return out;
}

type FunnelJson = {
  stages: Array<{
    list_id: string; name: string; slug: string; sort_order: number; is_archive: boolean; base: number;
    entered: number[]; forward: number[]; out: number[]; daily: Array<{ day: string; n: number }>;
  }>;
  new_leads: number[];
  new_leads_daily: Array<{ day: string; n: number }>;
  imported_excluded: number;
  quality: {
    total: number;
    holder_source: PulseQuality["holderSource"];
    destination: PulseQuality["destination"];
    origin_slug_shaped: PulseQuality["originSlugShaped"];
    origin_name_shaped: PulseQuality["originNameShaped"];
  };
};

export async function loadPulse(ctx: PulseContext): Promise<PulseResponse> {
  const { db, auth, window, tz, branchId, thresholds } = ctx;
  const p_from = window.from.toISOString();
  const p_to = window.to.toISOString();
  const bulk = { p_bulk_min: thresholds.bulkMinRows, p_bulk_seconds: thresholds.bulkBucketSeconds };

  // One pass: the stage moves are resolved once for both the scoreboard and the funnel (migration 280).
  const cutoff48 = new Date(window.to.getTime() - 48 * 3600_000).toISOString();
  // The intake list id(s): a plain lookup, NOT an embed (leads has two FKs to lead_lists → PGRST201 on an embed).
  const { data: intakeLists } = await db.from("lead_lists").select("id").eq("is_intake", true);
  const intakeIds = ((intakeLists ?? []) as unknown as Array<{ id: string }>).map((l) => l.id);
  const [overviewRes, untouchedRes, askEnabled] = await Promise.all([
    db.raw().rpc("education_pulse_overview", { p_tenant: auth.tenantId, p_from, p_to, p_tz: tz, p_branch: branchId, ...bulk }),
    // The untouched set = the leads link's filter (never touched, older than 48h, in the intake list) — one definition.
    intakeIds.length === 0
      ? Promise.resolve({ data: [], error: null })
      : db.from("leads").select("assigned_to, branch_id").in("list_id", intakeIds).is("deleted_at", null).is("last_touched_at", null)
          .lt("created_at", cutoff48).limit(5000),
    isAssistantEnabledForTenant(auth.tenantId).catch(() => false),
  ]);
  if (overviewRes.error) throw new Error(`education_pulse_overview: ${overviewRes.error.message}`);
  if (untouchedRes.error) throw new Error(`untouched leads: ${untouchedRes.error.message}`);

  const overview = overviewRes.data as { people: PersonBucketRow[]; funnel: FunnelJson };
  const bucketRows = overview.people ?? [];
  const funnel = overview.funnel;
  const coverage = await loadCoverage(ctx);
  const people = assemblePeople(await loadPeople(ctx, new Set(bucketRows.map((r) => r.user_id))), bucketRows, 4, coverage);
  const teamFirst = coverage.tenantFirst;
  const teamHasUsual = coveredUsualIndices(coverage, teamFirst).length >= MIN_COVERED_WINDOWS;
  const baselineCovered = prevCovered(coverage, teamFirst);

  const stageFlows: StageFlow[] = funnel.stages
    .filter((s) => !s.is_archive)
    .map((s) => ({
      listId: s.list_id,
      name: s.name,
      sortOrder: s.sort_order,
      base: Number(s.base ?? 0),
      entered: s.entered[0] ?? 0,
      forward: s.forward[0] ?? 0,
      out: s.out[0] ?? 0,
      previousOut: s.out[1] ?? 0,
      series: s.daily.map((d) => d.n),
    }));

  // Per-branch KPIs for the "biggest drop" rule.
  const byBranch = new Map<string, { name: string; cur: Record<string, number>; usual: Record<string, number>; hasUsual: boolean }>();
  for (const p of people) {
    if (!p.branchId) continue;
    const b = byBranch.get(p.branchId) ?? { name: p.branchName ?? "Branch", cur: {}, usual: {}, hasUsual: true };
    if (p.hasUsual === false) b.hasUsual = false; // a branch only has a usual when every member does
    for (const m of ["reached_applications", "prospects"] as const) {
      b.cur[m] = (b.cur[m] ?? 0) + p.current[m];
      b.usual[m] = (b.usual[m] ?? 0) + p.usual[m];
    }
    byBranch.set(p.branchId, b);
  }
  const branchKpis: BranchKpi[] = [];
  for (const [id, b] of byBranch) {
    for (const m of ["reached_applications", "prospects"] as const) {
      branchKpis.push({ branchId: id, name: b.name, metric: m, current: b.cur[m] ?? 0, usual: b.usual[m] ?? 0, hasUsual: b.hasUsual });
    }
  }

  const untouchedRows = (untouchedRes.data ?? []) as unknown as Array<{ assigned_to: string | null; branch_id: string | null }>;
  const untouchedCount = untouchedRows.length;
  const branchName = new Map(ctx.branches.map((b) => [b.id, b.name]));
  const personById = new Map(people.map((p) => [p.userId, p]));
  const tally = <K extends string>(keyOf: (r: { assigned_to: string | null; branch_id: string | null }) => K | null) => {
    const m = new Map<K, number>();
    for (const r of untouchedRows) { const k = keyOf(r); if (k) m.set(k, (m.get(k) ?? 0) + 1); }
    return m;
  };
  const byBranchCount = [...tally((r) => (r.branch_id ? (branchName.get(r.branch_id) ?? null) : null)).entries()]
    .map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count);
  const roleCounts = new Map<string, { key: string; label: string; count: number }>();
  for (const r of untouchedRows) {
    const holder = r.assigned_to ? personById.get(r.assigned_to) : null;
    if (!holder || holder.positionKey === "none") continue;
    const e = roleCounts.get(holder.positionKey) ?? { key: holder.positionKey, label: holder.positionLabel, count: 0 };
    e.count += 1;
    roleCounts.set(holder.positionKey, e);
  }
  const byRole = [...roleCounts.values()].sort((a, b) => b.count - a.count);

  const signals = computeSignals({
    people,
    stageFlows,
    untouched: { count: untouchedCount, byPerson: [] },
    branchKpis,
    thresholds,
  });
  for (const p of people) p.flag = signals.flags[p.userId] ?? null;
  // "Quiet since Thu": only for the few red-flagged people, from their daily series.
  await Promise.all(
    people.filter((p) => p.flag === "red").map(async (p) => {
      const { data } = await db.raw().rpc("education_pulse_person_daily", {
        p_tenant: auth.tenantId, p_from, p_to, p_tz: ctx.windowInfo.tz, p_user_id: p.userId,
        p_bulk_min: thresholds.bulkMinRows, p_bulk_seconds: thresholds.bulkBucketSeconds,
      });
      const daily = ((data ?? []) as Array<{ day: string; calls: number; notes: number; moves: number }>).map((d) => ({ day: d.day, calls: Number(d.calls), notes: Number(d.notes), moves: Number(d.moves) }));
      p.quietSinceDay = quietSinceDay(daily, activityOf(p.usual) / Math.max(ctx.windowInfo.days, 1));
    }),
  );

  // Real numbers for the suggestion values: leads a flagged-red person still holds that nobody touched this period
  // (active lists only), and why leads left the stages that leaked.
  const activeListIds = funnel.stages.filter((s) => !s.is_archive).map((s) => s.list_id);
  const staleHeld: Record<string, number> = {};
  await Promise.all(
    signals.all.filter((s) => s.kind === "activity_drop").map(async (s) => {
      const { count } = await db.from("leads").select("id", { count: "exact", head: true })
        .eq("assigned_to", s.subject.id).is("deleted_at", null).in("list_id", activeListIds)
        .or(`last_touched_at.is.null,last_touched_at.lt.${p_from}`);
      staleHeld[s.subject.id] = count ?? 0;
    }),
  );
  const leakReasons: Record<string, LeakReason[]> = {};
  await Promise.all(
    stageFlows.filter((f) => f.out >= 5).map(async (f) => {
      const { data } = await db.raw().rpc("education_pulse_leak_reasons", { p_tenant: auth.tenantId, p_from, p_to, p_list: f.listId });
      const rows = ((data ?? []) as Array<{ reason: string; leads: number }>).map((r) => ({ reason: r.reason, leads: Number(r.leads) }));
      if (rows.length) leakReasons[f.listId] = rows;
    }),
  );

  const winDays0 = (new Date(ctx.windowInfo.to).getTime() - new Date(ctx.windowInfo.from).getTime()) / 86_400_000;
  const win7 = Math.abs(winDays0 - 7) < 0.1, win1 = Math.abs(winDays0 - 1) < 0.1;
  const { groups, team } = rollups(people);
  const attention = buildAttention({
    people, signals: signals.all, stageFlows, leakReasons, staleHeld,
    untouched: { count: untouchedCount, byBranch: byBranchCount, byRole },
    periodNoun: win7 ? "this week" : win1 ? "today" : "this period",
  });
  const winDays = (new Date(ctx.windowInfo.to).getTime() - new Date(ctx.windowInfo.from).getTime()) / 86_400_000;
  const baselineLabel = Math.abs(winDays - 7) < 0.1 ? "last week" : Math.abs(winDays - 1) < 0.1 ? "yesterday" : "the period before";
  const nl0 = funnel.new_leads?.[0] ?? 0, nl1 = funnel.new_leads?.[1] ?? 0;
  const briefing = buildBriefing({ people, team, stageFlows, leakReasons, untouched: { count: untouchedCount }, thresholds, baselineLabel, baselineCovered, newLeads: { current: nl0, previous: nl1 } });
  const appsStage = funnel.stages.find((s) => s.slug === "applications");

  const nl = funnel.new_leads ?? [];
  const bulkByPerson = people.filter((p) => p.bulkMoves > 0).map((p) => ({ userId: p.userId, name: p.name, count: p.bulkMoves }));

  const q = funnel.quality;
  return {
    aiMode: ctx.aiMode,
    askEnabled,
    header: {
      tenantShortName: (ctx.tenantName.trim().split(/\s+/)[0] || "your team"),
      newLeads: nl[0] ?? 0,
      students: appsStage?.entered[0] ?? 0,
      needsAction: attention.filter((a) => a.category === "needs_action").length,
    },
    briefing,
    attention,
    coverage: { baselineCovered, hasUsual: teamHasUsual },
    window: ctx.windowInfo,
    branchId,
    branches: ctx.branches,
    people,
    groups,
    team,
    funnel: {
      stages: funnel.stages.map(
        (s): PulseFunnelStage => ({
          listId: s.list_id, name: s.name, slug: s.slug, sortOrder: s.sort_order, isArchive: s.is_archive, base: Number(s.base ?? 0),
          entered: s.entered, forward: s.forward, out: s.out, daily: s.daily,
        }),
      ),
      newLeads: {
        current: nl[0] ?? 0,
        previous: nl[1] ?? 0,
        usual: (() => { const idx = coveredUsualIndices(coverage, teamFirst); return idx.length >= MIN_COVERED_WINDOWS ? mean(idx.map((i) => nl[i + 1] ?? 0)) : 0; })(),
        daily: funnel.new_leads_daily ?? [],
      },
      importedExcluded: Number(funnel.imported_excluded ?? 0),
    },
    bulk: { moves: bulkByPerson.reduce((a, b) => a + b.count, 0), byPerson: bulkByPerson },
    signals: { keyChanges: signals.keyChanges, needsYou: signals.needsYou },
    quality: {
      total: q.total,
      holderSource: q.holder_source,
      destination: q.destination,
      originSlugShaped: q.origin_slug_shaped,
      originNameShaped: q.origin_name_shaped,
    },
    generatedAt: new Date().toISOString(),
  };
}
