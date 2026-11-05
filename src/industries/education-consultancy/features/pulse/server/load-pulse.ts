import { assemblePeople } from "../lib/assemble";
import { computeSignals } from "../lib/signals";
import { mean } from "../lib/window";
import {
  type BranchKpi,
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
    .select("user_id, role, branch_id, suspended_at, positions(name, slug)");
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
      branchId: m.branch_id,
      branchName: m.branch_id ? (branchName.get(m.branch_id) ?? null) : null,
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
  const [overviewRes, intakeRes] = await Promise.all([
    db.raw().rpc("education_pulse_overview", { p_tenant: auth.tenantId, p_from, p_to, p_tz: tz, p_branch: branchId, ...bulk }),
    db.raw().rpc("education_intake_alarm", { p_tenant: auth.tenantId, p_now: p_to, p_bucket1_hours: 24, p_bucket2_hours: 48 }),
  ]);
  if (overviewRes.error) throw new Error(`education_pulse_overview: ${overviewRes.error.message}`);

  const overview = overviewRes.data as { people: PersonBucketRow[]; funnel: FunnelJson };
  const bucketRows = overview.people ?? [];
  const funnel = overview.funnel;
  const people = assemblePeople(await loadPeople(ctx, new Set(bucketRows.map((r) => r.user_id))), bucketRows);

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
  const byBranch = new Map<string, { name: string; cur: Record<string, number>; usual: Record<string, number> }>();
  for (const p of people) {
    if (!p.branchId) continue;
    const b = byBranch.get(p.branchId) ?? { name: p.branchName ?? "Branch", cur: {}, usual: {} };
    for (const m of ["reached_applications", "prospects"] as const) {
      b.cur[m] = (b.cur[m] ?? 0) + p.current[m];
      b.usual[m] = (b.usual[m] ?? 0) + p.usual[m];
    }
    byBranch.set(p.branchId, b);
  }
  const branchKpis: BranchKpi[] = [];
  for (const [id, b] of byBranch) {
    for (const m of ["reached_applications", "prospects"] as const) {
      branchKpis.push({ branchId: id, name: b.name, metric: m, current: b.cur[m] ?? 0, usual: b.usual[m] ?? 0 });
    }
  }

  const alarm = ((intakeRes.data ?? []) as Array<{ buckets: Array<{ bucket: string; cnt: number }> }>)[0];
  const untouchedCount = (alarm?.buckets ?? []).find((b) => b.bucket === "48h+")?.cnt ?? 0;

  const signals = computeSignals({
    people,
    stageFlows,
    untouched: { count: Number(untouchedCount), byPerson: [] },
    branchKpis,
    thresholds,
  });
  for (const p of people) p.flag = signals.flags[p.userId] ?? null;

  const nl = funnel.new_leads ?? [];
  const bulkByPerson = people.filter((p) => p.bulkMoves > 0).map((p) => ({ userId: p.userId, name: p.name, count: p.bulkMoves }));

  const q = funnel.quality;
  return {
    window: ctx.windowInfo,
    branchId,
    branches: ctx.branches,
    people,
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
        usual: mean([nl[1] ?? 0, nl[2] ?? 0, nl[3] ?? 0, nl[4] ?? 0]),
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
