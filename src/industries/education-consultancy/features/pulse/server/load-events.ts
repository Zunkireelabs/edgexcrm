import { loadUserNames, isUuid, type PulseContext } from "./context";
import { assemblePeople } from "../lib/assemble";
import { loadPeople } from "./load-pulse";
import { untouchedHeldHref } from "../lib/leads-links";
import { untouchedHeldCutoff } from "../lib/untouched";
import { loadCoverage } from "./coverage";
import { loadBuckets } from "./buckets";
import { statusChangeLabel, statusLabel } from "../lib/status-label";

/** The tenant's status labels (pipeline stage name by slug — what the Leads page shows). */
async function loadStatusLabels(db: PulseContext["db"]): Promise<Record<string, string>> {
  const { data } = await db.from("pipeline_stages").select("slug,name");
  const out: Record<string, string> = {};
  for (const r of ((data ?? []) as unknown as Array<{ slug: string; name: string }>)) out[r.slug] = r.name;
  return out;
}
import { activityOf, type PersonBucketRow, type PulseEventRow, type PulseEventsResponse, type PulsePersonResponse } from "../lib/types";

export const EVENT_METRICS = [
  "calls", "notes", "moves", "moves_forward", "back_archived", "status_changes", "received", "prospects", "reached_applications",
  "applications_filed", "stage_out", "new_leads", "untouched",
] as const;
export type EventMetric = (typeof EVENT_METRICS)[number];

export function isEventMetric(v: string | null): v is EventMetric {
  return !!v && (EVENT_METRICS as readonly string[]).includes(v);
}

/** Leads-list deep link for metrics that map onto an existing `?list=` view; null when there is no honest mapping. */
export function leadsHrefFor(metric: EventMetric): string | null {
  switch (metric) {
    case "prospects": return "/leads?list=prospects";
    case "reached_applications": return "/leads?list=applications";
    case "untouched": return untouchedHeldHref();
    default: return null;
  }
}

interface EventRpcRow {
  lead_id: string; display_id: string | null; lead_name: string; at: string;
  actor_id: string | null; holder_id: string | null; from_label: string | null; to_label: string | null;
  detail: string | null; total: number;
}

export async function loadEvents(
  ctx: PulseContext,
  q: { metric: EventMetric; userId: string | null; detail: string | null; limit: number; offset: number },
): Promise<PulseEventsResponse> {
  const { db, auth, window, branchId, thresholds } = ctx;
  const { data, error } = await db.raw().rpc("education_pulse_events", {
    p_tenant: auth.tenantId,
    p_from: window.from.toISOString(),
    p_to: window.to.toISOString(),
    p_metric: q.metric,
    p_user_id: q.userId,
    p_detail: q.detail,
    p_branch: branchId,
    p_limit: q.limit,
    p_offset: q.offset,
    p_bulk_min: thresholds.bulkMinRows,
    p_bulk_seconds: thresholds.bulkBucketSeconds,
  });
  if (error) throw new Error(`education_pulse_events: ${error.message}`);
  const rows = (data ?? []) as EventRpcRow[];
  const names = await loadUserNames(db);
  const nameOf = (id: string | null) => (id ? (names.get(id)?.name ?? null) : null);
  const statusLabels = q.metric === "status_changes" ? await loadStatusLabels(db) : null;
  const lab = (s: string | null) => (statusLabels && s ? statusLabel(s, statusLabels) : s);
  return {
    rows: rows.map(
      (r): PulseEventRow => ({
        leadId: r.lead_id, displayId: r.display_id, leadName: r.lead_name, at: r.at,
        actorId: r.actor_id, actorName: nameOf(r.actor_id), holderId: r.holder_id, holderName: nameOf(r.holder_id),
        fromLabel: lab(r.from_label), toLabel: lab(r.to_label), detail: r.detail,
      }),
    ),
    total: rows.length ? Number(rows[0].total) : 0,
    limit: q.limit,
    offset: q.offset,
    openInLeadsHref: leadsHrefFor(q.metric),
  };
}

export async function loadPerson(ctx: PulseContext, userId: string): Promise<PulsePersonResponse | null> {
  const { db, auth, window, tz, thresholds } = ctx;
  if (!isUuid(userId)) return null;
  const p_from = window.from.toISOString();
  const p_to = window.to.toISOString();
  const bulk = { p_bulk_min: thresholds.bulkMinRows, p_bulk_seconds: thresholds.bulkBucketSeconds };

  const [statsAll, dailyRes, timelineRes] = await Promise.all([
    loadBuckets<PersonBucketRow[]>(
      ctx,
      (span) => db.raw().rpc("education_pulse_person_stats", { p_tenant: auth.tenantId, p_from: span.from.toISOString(), p_to: span.to.toISOString(), p_branch: null, ...bulk }),
      (d) => (d ?? []) as PersonBucketRow[],
    ),
    db.raw().rpc("education_pulse_person_daily", { p_tenant: auth.tenantId, p_from, p_to, p_tz: tz, p_user_id: userId, ...bulk }),
    db.raw().rpc("education_pulse_person_timeline", { p_tenant: auth.tenantId, p_from, p_to, p_user_id: userId, p_limit: 30, ...bulk }),
  ]);
  for (const r of [dailyRes, timelineRes]) if (r.error) throw new Error(r.error.message);

  const rows = statsAll.buckets.rows.filter((r) => r.user_id === userId);
  const infos = (await loadPeople(ctx, new Set([userId]))).filter((p) => p.userId === userId);
  if (infos.length === 0) return null;
  const [person] = assemblePeople(infos, rows, 4, await loadCoverage(ctx), statsAll.buckets.usualBuckets);

  const usualActivity = activityOf(person.usual); // coverage-aware: only windows the data covers
  const days = Math.max((window.to.getTime() - window.from.getTime()) / 86_400_000, 1);

  const { data: lists } = await db.from("lead_lists").select("id,is_archive");
  const activeListIds = ((lists ?? []) as unknown as Array<{ id: string; is_archive: boolean }>).filter((l) => !l.is_archive).map((l) => l.id);
  const held = activeListIds.length
    ? await db.from("leads").select("id", { count: "exact", head: true }).eq("assigned_to", userId).is("deleted_at", null).in("list_id", activeListIds)
    : { count: 0 };
  const stale = activeListIds.length
    ? await db.from("leads").select("id", { count: "exact", head: true }).eq("assigned_to", userId).is("deleted_at", null).in("list_id", activeListIds)
        .or(`last_touched_at.is.null,last_touched_at.lt.${untouchedHeldCutoff()}`).lt("stage_changed_at", untouchedHeldCutoff())
    : { count: 0 };

  const statusLabels = await loadStatusLabels(db);

  type Daily = { day: string; calls: number; notes: number; moves: number };
  type Tl = { at: string; kind: PulsePersonResponse["timeline"][number]["kind"]; lead_id: string; display_id: string | null; lead_name: string; detail: string | null };
  return {
    person,
    daily: ((dailyRes.data ?? []) as Daily[]).map((d) => ({ day: d.day, calls: Number(d.calls), notes: Number(d.notes), moves: Number(d.moves) })),
    usualPerDay: person.hasUsual === false ? 0 : usualActivity / days,
    hasUsual: person.hasUsual !== false,
    holds: held.count ?? 0,
    untouched: stale.count ?? 0,
    timeline: ((timelineRes.data ?? []) as Tl[]).map((t) => ({
      at: t.at, kind: t.kind, leadId: t.lead_id, displayId: t.display_id, leadName: t.lead_name,
      detail: t.kind === "status" ? statusChangeLabel(t.detail, statusLabels) : t.detail,
    })),
    window: ctx.windowInfo,
  };
}
