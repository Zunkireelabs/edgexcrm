import type { AuthContext } from "@/lib/api/auth";
import { canManageHR } from "@/lib/api/permissions";
import { getLeaveForHome, resolveUserNames } from "@/lib/supabase/queries";
import { scopedClient } from "@/lib/supabase/scoped";
import { encodeFilterTree } from "@/lib/filters/serialize";
import type { TenantConfig } from "@/types/database";
import { untouchedHeldOfPersonHref, untouchedLeadsHref } from "../../pulse/lib/leads-links";
import type { PulseResponse } from "../../pulse/lib/types";
import { loadPulse } from "../../pulse/server/load-pulse";
import { greeting, shortDate } from "../lib/greeting";
import { impactRows, impactStatus, measuringSince, type ImpactRaw, type ImpactRow } from "../lib/impact";
import { needsALook, type NeedsALook } from "../lib/needs-a-look";
import {
  atRiskRow,
  formerHolderRow,
  formerHolderHref,
  quietOverRow,
  staleCallbacksRow,
  attentionRows,
  quietOverHref,
  standaloneNudgeRow,
  unassignedRow,
  type NeedsYouRow,
} from "../lib/needs-you";
import { nudgeState, stillUntouchedCount, type NudgeRecord, type NudgeState } from "../lib/nudge";
import { deadlineDocsRule } from "../lib/rules/deadline-docs";
import { calendarDaysLabel, localDate } from "../lib/time";
import type { HomeScope } from "../lib/scope";
import { loadApplications, type HomeDb } from "./load-home";
import { autoAssignedRow, shadowCard, type AutoDecision, type ShadowCard } from "../lib/assignment/summary";
import { loadAssignmentSettings } from "./assignment/settings";
import { suggestForLeads } from "./assignment/suggest";
import { loadProcessPolicy } from "../../processes/server/policy";
import { workingMinutesBetween } from "../../processes/lib/working-hours";
import { buildRulesCard, type RulesCard } from "../lib/rules-card";
import { makeLeadScope } from "./lead-scope";
import { loadQuietOverTwoWeeks } from "./quiet-leads";
import { countStaleCallbacks } from "./stale-callbacks";
import type { HomeData } from "./load-page";
import { loadHome } from "./load-page";
import { buildHomePulseContext } from "./pulse-ctx";
import { canOpenNamedList } from "@/lib/leads/master-exclusion";
import { loadIntakeListIds, loadWorkablePlan } from "./workable";
import { applyWorkable, type WorkablePlan } from "../lib/workable";

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
  /** Shadow mode: how often smart assignment agreed with the managers (owner/admin only). */
  shadow: ShadowCard | null;
  /** "Rules from your processes" (T2): owner/admin only. */
  rules: RulesCard | null;
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

  const [leadScope, workable, policy, intakeListIds] = await Promise.all([makeLeadScope(db, auth, scope), loadWorkablePlan(db), loadProcessPolicy(db, auth.tenantId), loadIntakeListIds(db, (l) => canOpenNamedList(auth, l))]);
  // First-hour numbers follow the live clock: 60 office minutes when the process counts working hours.
  const workingClock = policy.source !== null && policy.firstContact.clock === "working";
  const [unassigned, former, nudges, atRisk, onLeave, impact, staleCount, quiet, untouchedHeld] = await Promise.all([
    loadUnassigned(db, scope.branchId, workable, intakeListIds),
    loadFormerHolders(db, scope.branchId, workable),
    loadNudgeStates(db, auth.userId, now, tz),
    loadAtRisk(db, scope.branchId, today, now, tz, pulse),
    loadOnLeaveToday(db, pulse.people.filter((p) => p.flag).map((p) => p.userId), today),
    loadImpact(db, auth.tenantId, launchedAt, scope.branchId, now, tz, workingClock),
    countStaleCallbacks(leadScope, now, tz),
    loadQuietOverTwoWeeks(leadScope, workable, pulse.people.map((p) => p.userId), now, tz),
    loadUntouchedHeld(db, scope.branchId, intakeListIds, now),
  ]);

  const nudgeByPerson = new Map<string, NudgeState>(nudges.map((n) => [n.toUserId, n.state]));
  // "Assign N new leads" is answered by smart assignment itself (the people the live process names for first contact, its filters
  // and its spread), the same function Pulse's untouched row calls. A branch manager's suggestion stays inside their branch.
  const suggestion = await suggestForLeads(db, auth.tenantId, unassigned.ids, { branchId: scope.branchId, now });
  // The Review link covers the same lists as the count: the personal lists plus the intake lists (as the former-holders link does).
  const unassignedHref = `/leads?${new URLSearchParams({
    f: encodeFilterTree({
      conjunction: "and",
      conditions: [
        { id: "home:unassigned", field: "assignees", op: "is_any_of", value: ["unassigned"] },
        ...(intakeListIds.length ? [{ id: "home:unassigned-lists", field: "stage", op: "is_any_of" as const, value: [...new Set([...workable.activeListIds, ...intakeListIds])] }] : []),
      ],
    }),
  }).toString()}`;

  const holderNames = await namesOf(untouchedHeld.holders.map((h) => h.userId), nameOf0(pulse));
  const attention = attentionRows(pulse.attention, nudgeByPerson, auth.userId, undefined, {
    untouchedHeld: {
      count: untouchedHeld.count,
      href: untouchedLeadsHref(intakeListIds, { heldOnly: true }),
      byHolder: untouchedHeld.holders.map((h) => ({ name: holderNames.get(h.userId) ?? "Someone", count: h.count })),
    },
    canOpenPulse: isAdmin,
  });
  const listedPeople = new Set(pulse.attention.flatMap((a) => a.links.flatMap((l) => (l.personId ? [l.personId] : []))));
  const nameOf = new Map(pulse.people.map((p) => [p.userId, p.name]));
  const standalone = nudges
    .filter((n) => n.state.kind === "returned" && !listedPeople.has(n.toUserId))
    .map((n) => {
      const st = n.state as Extract<NudgeState, { kind: "returned" }>;
      return standaloneNudgeRow(nameOf.get(n.toUserId) ?? "Someone", n.toUserId, st.still, st.when, untouchedHeldOfPersonHref(n.toUserId));
    });

  const scopeLabel = scope.branchId ? (branches.find((b) => b.id === scope.branchId)?.name ?? "this branch") : "all branches";
  const assignment = isAdmin ? await loadAssignmentCards(db, now, nameOf) : { shadow: null, auto: null };
  const assignmentMode = isAdmin ? (await loadAssignmentSettings(db)).mode : "off";
  const needsYou = [
    assignment.auto,
    unassignedRow({
      count: unassigned.count,
      oldestAt: unassigned.oldestAt,
      now,
      suggestion,
      leadIds: unassigned.count <= MAX_ASSIGN_IDS ? unassigned.ids : null,
      chooseHref: unassignedHref,
      // Only with a live process: today's plain "Waiting 14 h" when none is.
      target: policy.source && unassigned.oldestAt
        ? {
            waitMin: workingClock ? workingMinutesBetween(new Date(unassigned.oldestAt), now, policy.officeHours, tz) : (now.getTime() - Date.parse(unassigned.oldestAt)) / 60_000,
            targetMin: policy.assignWithinMin,
            long: workingClock ? { dayMin: policy.officeHours.endMin - policy.officeHours.startMin, days: calendarDaysLabel(new Date(unassigned.oldestAt), now, tz) } : undefined,
          }
        : undefined,
    }),
    formerHolderRow({ ...former, href: formerHolderHref(former.holderIds, former.activeListIds) }),
    ...standalone,
    ...attention,
    atRiskRow(atRisk, "/applications"),
    staleCallbacksRow(staleCount, scopeLabel),
    quietOverRow(quiet.total, quiet.byPerson.map((p) => ({ name: nameOf.get(p.userId) ?? "Someone", count: p.count })), scopeLabel, quietOverHref(workable)),
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
    shadow: assignment.shadow,
    rules: isAdmin ? buildRulesCard(policy, assignmentMode, tz) : null,
  };
}

/** Pulse's people, by id, for naming holders (the rest are looked up). */
const nameOf0 = (pulse: PulseResponse) => new Map(pulse.people.map((p) => [p.userId, p.name]));
async function namesOf(ids: string[], known: ReadonlyMap<string, string>): Promise<Map<string, string>> {
  const out = new Map(known);
  const missing = ids.filter((id) => !out.has(id));
  if (missing.length) for (const [id, name] of await resolveUserNames(missing)) out.set(id, name);
  return out;
}

/**
 * Untouched NEW leads that someone HOLDS: in the intake lists, never touched, created over 48 hours ago, `assigned_to` set. Pulse's
 * intake alarm counts the unassigned ones too, but those are already on "Assign N new leads", so Home's row counts held ones
 * only (a lead sits on one row). Same predicate as the `untouched_new` filter its Review link applies, plus "held".
 */
export async function loadUntouchedHeld(db: HomeDb, branchId: string | null, intakeListIds: string[], now: Date): Promise<{ count: number; holders: Array<{ userId: string; count: number }> }> {
  if (intakeListIds.length === 0) return { count: 0, holders: [] };
  let q = db
    .from("leads")
    .select("assigned_to", { count: "exact" })
    .in("list_id", intakeListIds)
    .is("deleted_at", null)
    .is("last_touched_at", null)
    .lt("created_at", new Date(now.getTime() - 48 * 3_600_000).toISOString())
    .not("assigned_to", "is", null)
    .limit(5000);
  if (branchId) q = q.eq("branch_id", branchId);
  const { data, count } = await q;
  const per = new Map<string, number>();
  for (const r of (data ?? []) as unknown as Array<{ assigned_to: string }>) per.set(r.assigned_to, (per.get(r.assigned_to) ?? 0) + 1);
  return { count: count ?? 0, holders: [...per].map(([userId, n]) => ({ userId, count: n })).sort((a, b) => b.count - a.count) };
}

async function loadLaunchDate(db: HomeDb): Promise<string | null> {
  const { data, error } = await db.from("home_settings").select("home_launched_at").maybeSingle();
  if (error) return null;
  return (data as unknown as { home_launched_at: string | null } | null)?.home_launched_at ?? null;
}

/** Unassigned workable leads (lib/workable.ts: active or non-archive intake list, not terminal / walk-in / on hold / archived), oldest first. */
export async function loadUnassigned(db: HomeDb, branchId: string | null, plan: WorkablePlan, intakeListIds: string[] = []): Promise<{ count: number; oldestAt: string | null; ids: string[] }> {
  // Intake lists count too (form leads land there unassigned); every other workable rule still applies. The personal-list plan is untouched.
  const lists = [...new Set([...plan.activeListIds, ...intakeListIds])];
  if (lists.length === 0) return { count: 0, oldestAt: null, ids: [] };
  let q = applyWorkable(db.from("leads").select("id, created_at", { count: "exact" }).is("assigned_to", null), { ...plan, activeListIds: lists })
    .order("created_at", { ascending: true })
    .limit(MAX_ASSIGN_IDS);
  if (branchId) q = q.eq("branch_id", branchId);
  const { data, count } = await q;
  const rows = (data ?? []) as unknown as Array<{ id: string; created_at: string }>;
  return { count: count ?? rows.length, oldestAt: rows[0]?.created_at ?? null, ids: rows.map((r) => r.id) };
}

/** Most ex-member-held active leads we read in one go (the count is exact; the stage / holder spread is from these). */
const FORMER_HOLDER_READ_CAP = 1000;

/**
 * Workable leads (lib/workable.ts) held by someone who is NOT a current `tenant_users` member. Suspended members are still members, so never counted.
 * Archived, terminal (won/lost), walk-in and on-hold leads never count. Branch scope is `leads.branch_id`, like the unassigned count.
 */
export async function loadFormerHolders(db: HomeDb, branchId: string | null, plan: WorkablePlan): Promise<{
  total: number;
  byStage: Array<{ name: string; count: number }>;
  applications: number;
  byHolder: Array<{ name: string | null; count: number }>;
  holderIds: string[];
  activeListIds: string[];
}> {
  const none = { total: 0, byStage: [], applications: 0, byHolder: [], holderIds: [], activeListIds: [] };
  const [{ data: listRows }, { data: memberRows }] = await Promise.all([
    db.from("lead_lists").select("id, name"),
    db.from("tenant_users").select("user_id"),
  ]);
  const lists = ((listRows ?? []) as unknown as Array<{ id: string; name: string }>).filter((l) => plan.activeListIds.includes(l.id));
  const members = ((memberRows ?? []) as unknown as Array<{ user_id: string }>).map((m) => m.user_id);
  if (lists.length === 0) return none;
  const activeListIds = lists.map((l) => l.id);
  let q = applyWorkable(db.from("leads").select("id, list_id, assigned_to", { count: "exact" }).not("assigned_to", "is", null), plan).limit(FORMER_HOLDER_READ_CAP);
  if (members.length > 0) q = q.not("assigned_to", "in", `(${members.join(",")})`);
  if (branchId) q = q.eq("branch_id", branchId);
  const { data, count } = await q;
  const rows = (data ?? []) as unknown as Array<{ id: string; list_id: string; assigned_to: string }>;
  if (rows.length === 0) return none;

  const stageName = new Map(lists.map((l) => [l.id, l.name]));
  const stageCount = new Map<string, number>();
  const holderCount = new Map<string, number>();
  for (const r of rows) {
    const sn = stageName.get(r.list_id) ?? "Other";
    stageCount.set(sn, (stageCount.get(sn) ?? 0) + 1);
    holderCount.set(r.assigned_to, (holderCount.get(r.assigned_to) ?? 0) + 1);
  }
  const holderIds = [...holderCount.keys()];
  const names = await resolveUserNames(holderIds);
  let applications = 0;
  for (const ids of chunk(rows.map((r) => r.id))) {
    const { count: c } = await db.from("applications").select("id", { count: "exact", head: true }).is("deleted_at", null).in("lead_id", ids);
    applications += c ?? 0;
  }
  return {
    total: count ?? rows.length,
    byStage: [...stageCount].map(([name, n]) => ({ name, count: n })),
    applications,
    byHolder: holderIds.map((id) => ({ name: names.get(id) ?? null, count: holderCount.get(id) ?? 0 })),
    holderIds,
    activeListIds,
  };
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

async function loadImpact(db: HomeDb, tenantId: string, launchedAt: string | null, branchId: string | null, now: Date, tz: string, working = false): Promise<ImpactCard> {
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
      p_working: working,
    });
    return error ? null : (data as unknown as ImpactRaw);
  };
  const [before, after] = await Promise.all([call(status.before), call(status.after)]);
  if (!before || !after) return { status: "measuring", since: measuringSince(status.before.to.toISOString(), tz), rows: [] };
  return { status: "ready", since: measuringSince(status.before.to.toISOString(), tz), rows: impactRows(before, after) };
}


/** Owner / admin only: the shadow-mode agreement card, or the auto-mode "assigned automatically" FYI row. Off = nothing. */
async function loadAssignmentCards(db: HomeDb, now: Date, names: ReadonlyMap<string, string>): Promise<{ shadow: ShadowCard | null; auto: NeedsYouRow | null }> {
  const settings = await loadAssignmentSettings(db);
  if (settings.mode === "off") return { shadow: null, auto: null };
  if (settings.mode === "shadow") {
    const { data } = await db.from("lead_assignment_decisions").select("mode, outcome").eq("mode", "shadow").limit(5000);
    return { shadow: shadowCard((data ?? []) as unknown as Array<{ mode: "shadow" | "auto"; outcome: "matched" | "overridden" | "undone" | null }>), auto: null };
  }
  const since = new Date(now.getTime() - 24 * 3_600_000).toISOString();
  const { data } = await db
    .from("lead_assignment_decisions")
    .select("id, lead_id, picked_user_id, created_at")
    .eq("mode", "auto")
    .eq("applied", true)
    .is("outcome", null)
    .gte("created_at", since)
    .order("created_at", { ascending: false })
    .limit(200);
  const rows = ((data ?? []) as unknown as Array<{ id: string; lead_id: string; picked_user_id: string | null; created_at: string }>).filter((r) => r.picked_user_id);
  if (rows.length === 0) return { shadow: null, auto: null };
  // "Already contacted": a touch on the lead since smart assignment gave it away (lib/contact.ts: last_touched_at).
  const touchedAfter = new Map(rows.map((r) => [r.lead_id, r.created_at]));
  let contacted = 0;
  for (const ids of chunk([...touchedAfter.keys()])) {
    const { data: ls } = await db.from("leads").select("id, last_touched_at").in("id", ids);
    for (const l of (ls ?? []) as unknown as Array<{ id: string; last_touched_at: string | null }>) {
      const at = touchedAfter.get(l.id);
      if (l.last_touched_at && at && Date.parse(l.last_touched_at) >= Date.parse(at)) contacted += 1;
    }
  }
  const decisions: AutoDecision[] = rows.map((r) => ({ id: r.id, leadId: r.lead_id, pickedUserId: r.picked_user_id as string }));
  return { shadow: null, auto: autoAssignedRow(decisions, names, contacted) };
}
