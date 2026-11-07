import { resolveUserNames } from "@/lib/supabase/queries";
import { scopedClientForTenant } from "@/lib/supabase/scoped";
import { normalizePosition } from "../../../pulse/lib/positions";
import { dayBounds } from "../../lib/time";
import { decideAssignment, type Candidate, type Decision } from "../../lib/assignment/score";
import { deriveLeadSignals } from "../../lib/assignment/signals";
import { attendanceMeaningful, buildTeam, personFromStats, type StatsRow } from "../../lib/assignment/stats";
import { PRESENT_ACTIVITY_HOURS } from "../../lib/assignment/weights";
import { loadWorkablePlan } from "../workable";
import { applyWorkable } from "../../lib/workable";
import { firstTouchKeys, loadAssignmentSettings, type TenantDb } from "./settings";

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
  const settings = await loadAssignmentSettings(db);
  const keys = firstTouchKeys(settings);
  const { data: tenantRow } = await db.fromGlobal("tenants").select("timezone").eq("id", tenantId).maybeSingle();
  const tz = (tenantRow as unknown as { timezone: string | null } | null)?.timezone ?? "Asia/Kathmandu";
  const today = dayBounds(now, tz).start.toISOString();
  const day = today.slice(0, 10);

  const { data: members } = await db.from("tenant_users").select("user_id, branch_id, suspended_at, positions(slug, name)");
  const poolMembers = ((members ?? []) as unknown as MemberRow[]).filter((m) => {
    const pos = Array.isArray(m.positions) ? m.positions[0] : m.positions;
    return pos?.slug && keys.includes(normalizePosition(pos.slug, pos.name).key);
  });
  const ids = poolMembers.map((m) => m.user_id);
  if (ids.length === 0) return { pool: [], team: buildTeam([], []), tz };

  const since2h = new Date(now.getTime() - PRESENT_ACTIVITY_HOURS * 3_600_000).toISOString();
  const since30d = new Date(now.getTime() - 30 * 86_400_000).toISOString().slice(0, 10);
  const [names, statsRes, workable, leaveRes, attRes, actRes, noteRes] = await Promise.all([
    resolveUserNames(ids),
    db.from("lead_assignment_stats").select("user_id, destination, received, progressed, speed_n, median_first_contact_min, flag_7d"),
    loadWorkablePlan(db),
    db.from("leave_requests").select("user_id").eq("approval_status", "approved").lte("start_date", day).gte("end_date", day).in("user_id", ids),
    db.from("attendance_records").select("user_id, work_date, clock_in_at, status").gte("work_date", since30d).limit(5000),
    db.from("lead_activities").select("user_id").in("user_id", ids).gte("created_at", since2h).limit(2000),
    db.from("lead_notes").select("user_id").in("user_id", ids).is("ai_tool_call_id", null).gte("created_at", since2h).limit(2000),
  ]);
  const stats = ((statsRes.data ?? []) as unknown as StatsRow[]);
  const onLeave = new Set(((leaveRes.data ?? []) as unknown as Array<{ user_id: string }>).map((r) => r.user_id));
  const att = (attRes.data ?? []) as unknown as Array<{ user_id: string; work_date: string; clock_in_at: string | null; status: string }>;
  const useAttendance = attendanceMeaningful(att.map((a) => a.user_id));
  const attendedToday = new Set(att.filter((a) => a.work_date === day && a.clock_in_at && a.status !== "absent").map((a) => a.user_id));
  const recentlyActive = new Set([...((actRes.data ?? []) as unknown as Array<{ user_id: string }>), ...((noteRes.data ?? []) as unknown as Array<{ user_id: string }>)].map((r) => r.user_id));

  const counts = await Promise.all(
    poolMembers.map(async (m) => {
      const [held, recvToday] = await Promise.all([
        // Workload = workable leads only (lib/workable.ts): a won / lost / walk-in / on-hold lead is not work they carry.
        workable.activeListIds.length
          ? applyWorkable(db.from("leads").select("id", { count: "exact", head: true }).eq("assigned_to", m.user_id), workable)
          : Promise.resolve({ count: 0 }),
        db.from("leads").select("id", { count: "exact", head: true }).eq("assigned_to", m.user_id).is("deleted_at", null)
          .or(`assigned_at.gte.${today},and(assigned_at.is.null,created_at.gte.${today})`),
      ]);
      return { id: m.user_id, held: held.count ?? 0, today: recvToday.count ?? 0 };
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
  const { data } = await db.from("leads").select("id, assigned_to, branch_id, destinations, first_name, last_name").eq("id", leadId).is("deleted_at", null).maybeSingle();
  return (data as unknown as LeadForAssignment | null) ?? null;
}

export async function decideForLead(tenantId: string, leadId: string, now: Date = new Date()): Promise<{ lead: LeadForAssignment; decision: Decision } | null> {
  const db = await scopedClientForTenant(tenantId);
  const lead = await loadLeadForAssignment(db, leadId);
  if (!lead) return null;
  const { pool, team } = await buildPool(db, tenantId, now);
  return { lead, decision: decideAssignment(deriveLeadSignals(lead), pool, team) };
}
