import { resolveUserNames } from "@/lib/supabase/queries";
import { scopedClientForTenant } from "@/lib/supabase/scoped";
import { normalizePosition } from "../../../pulse/lib/positions";
import { dayBounds } from "../../lib/time";
import { decideAssignment, type Candidate, type Decision } from "../../lib/assignment/score";
import { deriveLeadSignals } from "../../lib/assignment/signals";
import { attendanceMeaningful, buildTeam, personFromStats, type StatsRow } from "../../lib/assignment/stats";
import { DORMANT_DAYS, PRESENT_ACTIVITY_HOURS } from "../../lib/assignment/weights";
import { loadWorkablePlan } from "../workable";
import { leadNotes, noteReadFailed } from "../lead-notes";
import { logger } from "@/lib/logger";
import { applyWorkable } from "../../lib/workable";
import type { AssignmentMode } from "../../lib/assignment/outcome";
import { firstTouchKeys, loadAssignmentSettings, resolveFirstTouchPositions, type TenantDb } from "./settings";
import { loadProcessPolicy } from "../../../processes/server/policy";

/** A failed read is not "no rows": an empty pool would be stored as "nobody could take it" and never retried. */
function readOk<T extends { error?: { message: string } | null }>(what: string, res: T): T {
  if (res.error) throw new Error(`smart assignment: ${what} read failed: ${res.error.message}`);
  return res;
}

interface MemberRow {
  user_id: string;
  branch_id: string | null;
  suspended_at: string | null;
  positions: { slug: string | null; name: string | null } | Array<{ slug: string | null; name: string | null }> | null;
}


/**
 * Load the first-touch pool with everything the scorer needs, for ONE new lead. Reads only; the decision is pure
 * (lib/assignment/score.ts). Cost: a handful of tenant-wide queries plus two head counts per pool member (open leads, leads
 * received today); pools are a dozen people.
 */
export async function buildPool(db: TenantDb, tenantId: string, now: Date): Promise<{ pool: Candidate[]; team: ReturnType<typeof buildTeam>; tz: string }> {
  const settings = await loadAssignmentSettings(db, { strict: true });
  // "Who takes new leads" comes from the live New-lead process (its First contact step); saved/learned only when none is live.
  const policy = await loadProcessPolicy(db, tenantId);
  const keys = firstTouchKeys(await resolveFirstTouchPositions(db, settings, now, policy.firstTouchPositions));
  const { data: tenantRow } = readOk("tenant", await db.fromGlobal("tenants").select("timezone").eq("id", tenantId).maybeSingle());
  const tz = (tenantRow as unknown as { timezone: string | null } | null)?.timezone ?? "Asia/Kathmandu";
  const today = dayBounds(now, tz).start.toISOString();
  const day = today.slice(0, 10);

  const { data: members } = readOk("team members", await db.from("tenant_users").select("user_id, branch_id, suspended_at, positions(slug, name)"));
  const poolMembers = ((members ?? []) as unknown as MemberRow[]).filter((m) => {
    const pos = Array.isArray(m.positions) ? m.positions[0] : m.positions;
    return pos?.slug && keys.includes(normalizePosition(pos.slug, pos.name).key);
  });
  const ids = poolMembers.map((m) => m.user_id);
  if (ids.length === 0) return { pool: [], team: buildTeam([], []), tz };

  const since2h = new Date(now.getTime() - PRESENT_ACTIVITY_HOURS * 3_600_000).toISOString();
  const since14d = new Date(now.getTime() - DORMANT_DAYS * 86_400_000).toISOString();
  const since30d = new Date(now.getTime() - 30 * 86_400_000).toISOString().slice(0, 10);
  const [names, statsRes, workable, leaveRes, attRes, actRes, noteRes] = await Promise.all([
    resolveUserNames(ids),
    db.from("lead_assignment_stats").select("user_id, destination, received, progressed, speed_n, median_first_contact_min, flag_7d"),
    loadWorkablePlan(db),
    db.from("leave_requests").select("user_id").eq("approval_status", "approved").lte("start_date", day).gte("end_date", day).in("user_id", ids),
    db.from("attendance_records").select("user_id, work_date, clock_in_at, status").gte("work_date", since30d).limit(5000),
    db.from("lead_activities").select("user_id").in("user_id", ids).gte("created_at", since2h).limit(2000),
    leadNotes(db, tenantId, "user_id").in("user_id", ids).is("ai_tool_call_id", null).gte("created_at", since2h).limit(2000),
  ]);
  noteReadFailed("smart assignment: present (last 2h notes)", noteRes.error);
  readOk("assignment stats", statsRes);
  readOk("leave", leaveRes);
  readOk("attendance", attRes);
  readOk("recent activity", actRes);
  const stats = ((statsRes.data ?? []) as unknown as StatsRow[]);
  const onLeave = new Set(((leaveRes.data ?? []) as unknown as Array<{ user_id: string }>).map((r) => r.user_id));
  const att = (attRes.data ?? []) as unknown as Array<{ user_id: string; work_date: string; clock_in_at: string | null; status: string }>;
  const useAttendance = attendanceMeaningful(att.map((a) => a.user_id));
  const attendedToday = new Set(att.filter((a) => a.work_date === day && a.clock_in_at && a.status !== "absent").map((a) => a.user_id));
  const recentlyActive = new Set([...((actRes.data ?? []) as unknown as Array<{ user_id: string }>), ...((noteRes.data ?? []) as unknown as Array<{ user_id: string }>)].map((r) => r.user_id));

  const counts = await Promise.all(
    poolMembers.map(async (m) => {
      const [held, recvToday, acts14, notes14] = await Promise.all([
        // Workload = workable leads only (lib/workable.ts): a won / lost / walk-in / on-hold lead is not work they carry.
        workable.activeListIds.length
          ? applyWorkable(db.from("leads").select("id", { count: "exact", head: true }).eq("assigned_to", m.user_id), workable)
          : Promise.resolve({ count: 0, error: null }),
        db.from("leads").select("id", { count: "exact", head: true }).eq("assigned_to", m.user_id).is("deleted_at", null)
          .or(`assigned_at.gte.${today},and(assigned_at.is.null,created_at.gte.${today})`),
        // "Working" = any lead activity or human note in the last 14 days (the same union as lib/contact.ts). A shared mailbox or a
        // left-but-not-removed account shows none, and must never be handed a lead.
        db.from("lead_activities").select("id", { count: "exact", head: true }).eq("user_id", m.user_id).gte("created_at", since14d),
        leadNotes(db, tenantId, "id", { count: "exact", head: true }).eq("user_id", m.user_id).is("ai_tool_call_id", null).gte("created_at", since14d),
      ]);
      readOk("held leads", held);
      readOk("received today", recvToday);
      // A failed read is NOT "no activity": log it and don't call the person dormant on our own error.
      const readFailed = [acts14.error, notes14.error].map((e, i) => (e ? (logger.error({ userId: m.user_id, err: e.message, source: i ? "lead_notes" : "lead_activities" }, "smart assignment: dormant check read failed"), true) : false)).some(Boolean);
      return { id: m.user_id, held: held.count ?? 0, today: recvToday.count ?? 0, working: readFailed || (acts14.count ?? 0) + (notes14.count ?? 0) > 0 };
    }),
  );
  const countBy = new Map(counts.map((c) => [c.id, c]));

  const pool: Candidate[] = poolMembers.map((m) => {
    const pos = Array.isArray(m.positions) ? m.positions[0] : m.positions;
    const s = personFromStats(stats, m.user_id);
    return {
      userId: m.user_id,
      name: names.get(m.user_id) ?? "Unknown",
      positionKey: normalizePosition(pos?.slug, pos?.name).key,
      branchId: m.branch_id,
      active: !m.suspended_at,
      onLeave: onLeave.has(m.user_id),
      dormant: !(countBy.get(m.user_id)?.working ?? false),
      flag7d: s.flag7d,
      heldOpen: countBy.get(m.user_id)?.held ?? 0,
      receivedToday: countBy.get(m.user_id)?.today ?? 0,
      overall: s.overall,
      byDestination: s.byDestination,
      present: useAttendance ? attendedToday.has(m.user_id) : recentlyActive.has(m.user_id),
    };
  });
  return { pool, team: buildTeam(stats, ids), tz };
}

export interface LeadForAssignment {
  id: string;
  assigned_to: string | null;
  branch_id: string | null;
  destinations: string[] | null;
  first_name: string | null;
  last_name: string | null;
}

export async function loadLeadForAssignment(db: TenantDb, leadId: string): Promise<LeadForAssignment | null> {
  // null = the lead really is not there; a failed query throws.
  const { data } = readOk("lead", await db.from("leads").select("id, assigned_to, branch_id, destinations, first_name, last_name").eq("id", leadId).is("deleted_at", null).maybeSingle());
  return (data as unknown as LeadForAssignment | null) ?? null;
}

/** Today's shadow picks nobody has acted on yet, per person. Shadow assigns nothing, so these are invisible to `assigned_at`. */
async function openShadowPicksToday(db: TenantDb, tz: string, now: Date): Promise<Map<string, number>> {
  const { data } = readOk(
    "today's shadow picks",
    await db.from("lead_assignment_decisions").select("picked_user_id").eq("mode", "shadow").is("outcome", null).not("picked_user_id", "is", null).gte("created_at", dayBounds(now, tz).start.toISOString()).limit(5000),
  );
  const perPerson = new Map<string, number>();
  for (const r of (data ?? []) as unknown as Array<{ picked_user_id: string }>) perPerson.set(r.picked_user_id, (perPerson.get(r.picked_user_id) ?? 0) + 1);
  return perPerson;
}

export async function decideForLead(tenantId: string, leadId: string, mode: AssignmentMode, now: Date = new Date()): Promise<{ lead: LeadForAssignment; decision: Decision } | null> {
  const db = await scopedClientForTenant(tenantId);
  const lead = await loadLeadForAssignment(db, leadId);
  if (!lead) return null;
  const { pool, team, tz } = await buildPool(db, tenantId, now);
  // Here and not in buildPool: the suggestion seeds these same picks itself and must not count them twice.
  const picks = mode === "shadow" ? await openShadowPicksToday(db, tz, now) : null;
  const counted = picks ? pool.map((c) => ({ ...c, receivedToday: c.receivedToday + (picks.get(c.userId) ?? 0) })) : pool;
  return { lead, decision: decideAssignment(deriveLeadSignals(lead), counted, team) };
}
