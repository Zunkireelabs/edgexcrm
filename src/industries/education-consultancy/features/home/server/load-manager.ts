import type { AuthContext } from "@/lib/api/auth";
import { canManageHR } from "@/lib/api/permissions";
import { getLeaveForHome, resolveUserNames } from "@/lib/supabase/queries";
import { scopedClient } from "@/lib/supabase/scoped";
import { encodeFilterTree } from "@/lib/filters/serialize";
import type { TenantConfig } from "@/types/database";
import { normalizePosition } from "../../pulse/lib/positions";
import { planReassign } from "../../pulse/lib/suggest";
import { untouchedHeldOfPersonHref } from "../../pulse/lib/leads-links";
import type { PulseResponse } from "../../pulse/lib/types";
import { loadPulse } from "../../pulse/server/load-pulse";
import { greeting, shortDate } from "../lib/greeting";
import { impactRows, impactStatus, measuringSince, type ImpactRaw, type ImpactRow } from "../lib/impact";
import { needsALook, type NeedsALook } from "../lib/needs-a-look";
import {
  atRiskRow,
  quietOverRow,
  staleCallbacksRow,
  attentionRows,
  standaloneNudgeRow,
  unassignedRow,
  type NeedsYouRow,
} from "../lib/needs-you";
import { nudgeState, stillUntouchedCount, type NudgeRecord, type NudgeState } from "../lib/nudge";
import { deadlineDocsRule } from "../lib/rules/deadline-docs";
import { localDate } from "../lib/time";
import type { HomeScope } from "../lib/scope";
import { loadApplications, type HomeDb } from "./load-home";
import { makeLeadScope } from "./lead-scope";
import { loadQuietOverTwoWeeks } from "./quiet-leads";
import { countStaleCallbacks } from "./stale-callbacks";
import type { HomeData } from "./load-page";
import { loadHome } from "./load-page";
import { buildHomePulseContext } from "./pulse-ctx";

/** Beyond this many unassigned leads "Assign as suggested" is not offered (the list view does that job). */
export const MAX_ASSIGN_IDS = 500;
const CHUNK = 100;

export interface ImpactCard {
  status: "unset" | "measuring" | "ready";
  /** "25 Nov", for "Measuring since 25 Nov". */
  since: string | null;
  rows: ImpactRow[];
}

export interface ManagerData {
  tz: string;
  greeting: string;
  lede: string;
  dateShort: string;
  needsYou: NeedsYouRow[];
  needsALook: NeedsALook;
  /** /pulse is owner/admin-only: a branch manager sees the card without the link. */
  canOpenPulse: boolean;
  impact: ImpactCard;
  canSetLaunch: boolean;
  own: HomeData;
  leaveWaiting: number;
  branchName: string | null;
}

function chunk<T>(xs: T[], n = CHUNK): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < xs.length; i += n) out.push(xs.slice(i, i + n));
  return out;
}

/**
 * The owner / manager Home. Pulse's 7-day context is built once (`loadPulse`) and its attention list, people, flags and
 * held load feed everything below, so Home and Pulse read the same inputs. Scope comes from `resolveHomeScope`.
 */
export async function loadManagerHome(
  auth: AuthContext,
  tenant: { name: string | null; timezone: string | null; config: TenantConfig | null },
  scope: Extract<HomeScope, { mode: "manager" }>,
  firstName: string,
  now: Date = new Date(),
): Promise<ManagerData> {
  const tz = tenant.timezone ?? "Asia/Kathmandu";
  const db = await scopedClient(auth);
  const today = localDate(now, tz);
  const isAdmin = auth.role === "owner" || auth.role === "admin";

  const { data: branchRows } = await db.from("branches").select("id, name").order("sort_order", { ascending: true });
  const branches = ((branchRows ?? []) as unknown as Array<{ id: string; name: string }>).map((b) => ({ id: b.id, name: b.name }));
  const ctx = buildHomePulseContext(auth, db, tz, tenant.config, now, scope.branchId, branches, tenant.name ?? "");
  if (!ctx) throw new Error("home: could not resolve the 7-day window");

  const [pulse, own, leaveSummary, launchedAt] = await Promise.all([
    loadPulse(ctx),
    loadHome(auth, { timezone: tenant.timezone, config: tenant.config }, firstName, now, { withWeek: false }),
    getLeaveForHome(auth.tenantId, auth.userId, canManageHR(auth.permissions)),
    loadLaunchDate(db),
  ]);

  const flags7d: Record<string, "red" | "amber" | "green"> = {};
  for (const p of pulse.people) if (p.flag) flags7d[p.userId] = p.flag;

  const leadScope = await makeLeadScope(db, auth, scope);
  const [unassigned, nudges, atRisk, onLeave, impact, staleCount, quiet] = await Promise.all([
    loadUnassigned(db, scope.branchId),
    loadNudgeStates(db, auth.userId, now, tz),
    loadAtRisk(db, scope.branchId, today, now, tz, pulse),
    loadOnLeaveToday(db, pulse.people.filter((p) => p.flag).map((p) => p.userId), today),
    loadImpact(db, auth.tenantId, launchedAt, scope.branchId, now, tz),
    countStaleCallbacks(leadScope, now, tz),
    loadActiveListIds(db).then((ids) => loadQuietOverTwoWeeks(leadScope, ids, pulse.people.map((p) => p.userId), now, tz)),
  ]);

  const nudgeByPerson = new Map<string, NudgeState>(nudges.map((n) => [n.toUserId, n.state]));
  const plan = planReassign(pulse.people, { userId: null, positionKey: normalizePosition("lead-caller").key }, unassigned.count, pulse.heldLoad ?? {}, flags7d);
  const unassignedHref = `/leads?${new URLSearchParams({ f: encodeFilterTree({ conjunction: "and", conditions: [{ id: "home:unassigned", field: "assignees", op: "is_any_of", value: ["unassigned"] }] }) }).toString()}`;

  const attention = attentionRows(pulse.attention, nudgeByPerson, auth.userId);
  const listedPeople = new Set(pulse.attention.flatMap((a) => a.links.flatMap((l) => (l.personId ? [l.personId] : []))));
  const nameOf = new Map(pulse.people.map((p) => [p.userId, p.name]));
  const standalone = nudges
    .filter((n) => n.state.kind === "returned" && !listedPeople.has(n.toUserId))
    .map((n) => {
      const st = n.state as Extract<NudgeState, { kind: "returned" }>;
      return standaloneNudgeRow(nameOf.get(n.toUserId) ?? "Someone", n.toUserId, st.still, st.when, untouchedHeldOfPersonHref(n.toUserId));
    });

  const scopeLabel = scope.branchId ? (branches.find((b) => b.id === scope.branchId)?.name ?? "this branch") : "all branches";
  const needsYou = [
    unassignedRow({
      count: unassigned.count,
      oldestAt: unassigned.oldestAt,
      now,
      plan,
      leadIds: unassigned.count <= MAX_ASSIGN_IDS ? unassigned.ids : null,
      chooseHref: unassignedHref,
    }),
    ...standalone,
    ...attention,
    atRiskRow(atRisk, "/applications"),
    staleCallbacksRow(staleCount, scopeLabel),
    quietOverRow(quiet.total, quiet.byPerson.map((p) => ({ name: nameOf.get(p.userId) ?? "Someone", count: p.count })), scopeLabel),
  ].filter((r): r is NeedsYouRow => r !== null);

  const shortName = ctx.tenantName.trim().split(/\s+/)[0] || "Your team";
  const branchName = scope.branchId ? branches.find((b) => b.id === scope.branchId)?.name ?? null : null;
  return {
    tz,
    greeting: greeting(firstName, now, tz),
    lede: `${branchName ?? shortName} today · ${pulse.header.newLeads} new leads this week · ${needsYou.length} ${needsYou.length === 1 ? "thing needs" : "things need"} you`,
    dateShort: shortDate(now, tz),
    needsYou,
    needsALook: needsALook(pulse.people, onLeave, auth.userId),
    canOpenPulse: isAdmin,
    impact,
    canSetLaunch: isAdmin,
    own,
    leaveWaiting: leaveSummary.pendingLeaveApprovals,
    branchName,
  };
}

async function loadLaunchDate(db: HomeDb): Promise<string | null> {
  const { data, error } = await db.from("home_settings").select("home_launched_at").maybeSingle();
  if (error) return null;
  return (data as unknown as { home_launched_at: string | null } | null)?.home_launched_at ?? null;
}

/** Unassigned leads in active (non-archive, non-staging) lists, oldest first. */
async function loadUnassigned(db: HomeDb, branchId: string | null): Promise<{ count: number; oldestAt: string | null; ids: string[] }> {
  const { data: listRows } = await db.from("lead_lists").select("id, is_archive, is_staging");
  const active = ((listRows ?? []) as unknown as Array<{ id: string; is_archive: boolean; is_staging: boolean | null }>)
    .filter((l) => !l.is_archive && !l.is_staging)
    .map((l) => l.id);
  if (active.length === 0) return { count: 0, oldestAt: null, ids: [] };
  let q = db
    .from("leads")
    .select("id, created_at", { count: "exact" })
    .is("assigned_to", null)
    .is("deleted_at", null)
    .is("archived_at", null)
    .in("list_id", active)
    .order("created_at", { ascending: true })
    .limit(MAX_ASSIGN_IDS);
  if (branchId) q = q.eq("branch_id", branchId);
  const { data, count } = await q;
  const rows = (data ?? []) as unknown as Array<{ id: string; created_at: string }>;
  return { count: count ?? rows.length, oldestAt: rows[0]?.created_at ?? null, ids: rows.map((r) => r.id) };
}

/** My open nudges and where each stands; one that has nothing left untouched is stamped resolved. */
async function loadNudgeStates(db: HomeDb, userId: string, now: Date, tz: string): Promise<Array<NudgeRecord & { state: NudgeState }>> {
  const { data, error } = await db
    .from("lead_nudges")
    .select("id, to_user_id, lead_ids, created_at, resolved_at")
    .eq("from_user_id", userId)
    .is("resolved_at", null)
    .order("created_at", { ascending: false })
    .limit(100);
  if (error) return [];
  const rows = (data ?? []) as unknown as Array<{ id: string; to_user_id: string; lead_ids: string[]; created_at: string; resolved_at: string | null }>;
  const seen = new Set<string>();
  const out: Array<NudgeRecord & { state: NudgeState }> = [];
  for (const r of rows) {
    const leads: Array<{ id: string; lastTouchedAt: string | null }> = [];
    for (const ids of chunk(r.lead_ids)) {
      const { data: ls } = await db.from("leads").select("id, last_touched_at").in("id", ids).is("deleted_at", null);
      for (const l of (ls ?? []) as unknown as Array<{ id: string; last_touched_at: string | null }>) leads.push({ id: l.id, lastTouchedAt: l.last_touched_at });
    }
    const rec: NudgeRecord = { id: r.id, toUserId: r.to_user_id, leadIds: r.lead_ids, createdAt: r.created_at, resolvedAt: r.resolved_at };
    const state = nudgeState(rec, stillUntouchedCount(leads, r.created_at), now, tz);
    if (state.kind === "resolved") {
      await db.from("lead_nudges").update({ resolved_at: now.toISOString() }).eq("id", r.id);
      continue;
    }
    if (seen.has(r.to_user_id)) continue; // the latest nudge per person speaks for them
    seen.add(r.to_user_id);
    out.push({ ...rec, state });
  }
  return out;
}

/** Applications closing within 7 days with documents missing (A1's deadline_docs verdict), in the manager's scope. */
async function loadAtRisk(
  db: HomeDb, branchId: string | null, today: string, now: Date, tz: string, pulse: PulseResponse,
) {
  const { applications, submitStageByPipeline } = await loadApplications(db, { branchId }, today);
  const hits = new Set(deadlineDocsRule(applications, submitStageByPipeline, { now, tz }).map((i) => i.key.replace("deadline_docs:", "")));
  const risky = applications.filter((a) => hits.has(a.id));
  const names = new Map(pulse.people.map((p) => [p.userId, p.name]));
  const missing = risky.filter((a) => a.assigneeId && !names.has(a.assigneeId)).map((a) => a.assigneeId as string);
  const extra = missing.length ? await resolveUserNames(missing) : new Map<string, string>();
  return risky
    .sort((a, b) => (a.deadline ?? "").localeCompare(b.deadline ?? "") || a.leadName.localeCompare(b.leadName))
    .map((a) => ({
      id: a.id,
      leadName: a.leadName,
      assigneeName: a.assigneeId ? names.get(a.assigneeId) ?? extra.get(a.assigneeId) ?? null : null,
      missingCount: a.docs.missingLabels.length,
    }));
}

/** Who among `userIds` has approved leave covering today (HRMS leave_requests). */
async function loadOnLeaveToday(db: HomeDb, userIds: string[], today: string): Promise<Set<string>> {
  if (userIds.length === 0) return new Set();
  const { data, error } = await db
    .from("leave_requests")
    .select("user_id")
    .eq("approval_status", "approved")
    .lte("start_date", today)
    .gte("end_date", today)
    .in("user_id", userIds);
  if (error) return new Set();
  return new Set(((data ?? []) as unknown as Array<{ user_id: string }>).map((r) => r.user_id));
}

async function loadImpact(db: HomeDb, tenantId: string, launchedAt: string | null, branchId: string | null, now: Date, tz: string): Promise<ImpactCard> {
  const status = impactStatus(launchedAt, now);
  if (status.kind === "unset") return { status: "unset", since: null, rows: [] };
  if (status.kind === "measuring") return { status: "measuring", since: measuringSince(status.since, tz), rows: [] };
  const call = async (w: { from: Date; to: Date }): Promise<ImpactRaw | null> => {
    const { data, error } = await db.raw().rpc("education_home_impact", {
      p_tenant: tenantId,
      p_branch: branchId,
      p_from: w.from.toISOString(),
      p_to: w.to.toISOString(),
      p_tz: tz,
    });
    return error ? null : (data as unknown as ImpactRaw);
  };
  const [before, after] = await Promise.all([call(status.before), call(status.after)]);
  if (!before || !after) return { status: "measuring", since: measuringSince(status.before.to.toISOString(), tz), rows: [] };
  return { status: "ready", since: measuringSince(status.before.to.toISOString(), tz), rows: impactRows(before, after) };
}


async function loadActiveListIds(db: HomeDb): Promise<string[]> {
  const { data } = await db.from("lead_lists").select("id, is_archive, is_staging");
  return ((data ?? []) as unknown as Array<{ id: string; is_archive: boolean; is_staging: boolean | null }>).filter((l) => !l.is_archive && !l.is_staging).map((l) => l.id);
}
