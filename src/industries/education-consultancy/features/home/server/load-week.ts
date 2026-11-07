import type { AuthContext } from "@/lib/api/auth";
import type { TenantConfig } from "@/types/database";
import { assemblePeople } from "../../pulse/lib/assemble";
import type { PersonBucketRow } from "../../pulse/lib/types";
import { loadBuckets } from "../../pulse/server/buckets";
import { loadCoverage } from "../../pulse/server/coverage";
import { buildHomePulseContext } from "./pulse-ctx";
import { loadPeople } from "../../pulse/server/load-pulse";
import { addDaysStr, localDate } from "../lib/time";
import {
  countMetric,
  firstHourCounts,
  firstHourMetric,
  leaveText,
  type WeekMetric,
} from "../lib/week-stats";
import type { HomeDb } from "./load-home";

const DAY = 86_400_000;

/**
 * "Your last 7 days". Calls made and moved-to-next-stage come from Pulse's OWN per-person maths (the same RPC,
 * assemblePeople and compareToUsual), so the numbers match Pulse exactly. This is an internal call: the Pulse HTTP
 * routes are owner/admin-only, so a PulseContext is built here for the signed-in person's own row only.
 */
export async function loadMyWeek(
  auth: AuthContext,
  db: HomeDb,
  tz: string,
  config: TenantConfig | null | undefined,
  now: Date,
): Promise<WeekMetric[]> {
  const ctx = buildHomePulseContext(auth, db, tz, config, now, null, []);
  if (!ctx) return [];
  const { window, thresholds } = ctx;
  const bulk = { p_bulk_min: thresholds.bulkMinRows, p_bulk_seconds: thresholds.bulkBucketSeconds };

  const [statsAll, coverage, leave, firstHour] = await Promise.all([
    loadBuckets<PersonBucketRow[]>(
      ctx,
      (span) => db.raw().rpc("education_pulse_person_stats", { p_tenant: auth.tenantId, p_from: span.from.toISOString(), p_to: span.to.toISOString(), p_branch: null, ...bulk }),
      (d) => (d ?? []) as PersonBucketRow[],
    ),
    loadCoverage(ctx),
    loadLeaveDays(db, auth.userId, window.from, window.to, tz),
    loadFirstHour(db, auth.userId, now),
  ]);
  const infos = (await loadPeople(ctx, new Set([auth.userId]))).filter((p) => p.userId === auth.userId);
  const rows = statsAll.buckets.rows.filter((r) => r.user_id === auth.userId);
  const [me] = infos.length ? assemblePeople(infos, rows, 4, coverage, statsAll.buckets.usualBuckets) : [];

  const hasUsual = me ? me.hasUsual !== false : false;
  const why = leaveText(leave);
  return [
    countMetric("calls", "Calls made", { current: me?.current.calls ?? 0, usual: me?.usual.calls ?? 0, hasUsual }, why),
    firstHourMetric(firstHour),
    countMetric("moves", "Moved to the next stage", { current: me?.current.moves ?? 0, usual: me?.usual.moves ?? 0, hasUsual }, why),
  ];
}

/** Tenant-local dates inside [from, to) on which the person had APPROVED leave (HRMS `leave_requests`). */
async function loadLeaveDays(db: HomeDb, userId: string, from: Date, to: Date, tz: string): Promise<string[]> {
  const fromDay = localDate(from, tz);
  const toDay = localDate(new Date(to.getTime() - 1), tz);
  const { data, error } = await db
    .from("leave_requests")
    .select("start_date, end_date")
    .eq("user_id", userId)
    .eq("approval_status", "approved")
    .lte("start_date", toDay)
    .gte("end_date", fromDay);
  if (error) return [];
  const days = new Set<string>();
  for (const r of (data ?? []) as unknown as Array<{ start_date: string; end_date: string }>) {
    for (let d = r.start_date; d <= r.end_date; d = addDaysStr(d, 1)) if (d >= fromDay && d <= toDay) days.add(d);
  }
  return [...days];
}

/** "New leads called within 1 hour": this week against the mean of the 4 weeks before it. */
async function loadFirstHour(db: HomeDb, userId: string, now: Date) {
  const t1 = now.getTime();
  const earliest = t1 - 35 * DAY;
  const iso = new Date(earliest).toISOString();
  const [leadsRes, callsRes] = await Promise.all([
    db
      .from("leads")
      .select("id, assigned_at, created_at")
      .eq("assigned_to", userId)
      .is("deleted_at", null)
      .or(`assigned_at.gte.${iso},and(assigned_at.is.null,created_at.gte.${iso})`)
      .limit(3000),
    db.from("lead_activities").select("lead_id, created_at").eq("activity_type", "call").eq("user_id", userId).gte("created_at", iso).limit(10000),
  ]);
  const leads = ((leadsRes.data ?? []) as unknown as Array<{ id: string; assigned_at: string | null; created_at: string }>).map((l) => ({
    id: l.id,
    assignedAt: Date.parse(l.assigned_at ?? l.created_at),
  }));
  const callsByLead = new Map<string, number[]>();
  for (const c of (callsRes.data ?? []) as unknown as Array<{ lead_id: string; created_at: string }>) {
    const list = callsByLead.get(c.lead_id) ?? [];
    list.push(Date.parse(c.created_at));
    callsByLead.set(c.lead_id, list);
  }
  const current = firstHourCounts(leads, callsByLead, t1 - 7 * DAY, t1);
  const prior = [1, 2, 3, 4].map((i) => firstHourCounts(leads, callsByLead, t1 - (i + 1) * 7 * DAY, t1 - i * 7 * DAY));
  const total = prior.reduce((s, p) => s + p.total, 0);
  const usual = total === 0 ? null : { called: prior.reduce((s, p) => s + p.called, 0) / 4, total: total / 4 };
  return { current, usual };
}
