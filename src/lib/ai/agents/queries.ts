import { scopedClientForTenant } from "@/lib/supabase/scoped";
import "@/lib/ai/agents/packs"; // module-load registration — must run before getAgentDefinition(s)
// capabilities.ts already imports "@/lib/ai/tools/packs" at its own module
// load (same reasoning as its docstring: getRegisteredTools() must never see
// an empty registry) — this import is redundant given queries.ts already
// imports capabilities.ts below, but explicit rather than relying on that
// transitive side effect, per the 5.4d brief's instruction to confirm this.
import "@/lib/ai/tools/packs";
import { getAgentDefinition, getAgentDefinitionsForIndustry } from "./registry";
import { describeCapabilities, WRITE_TOOL_PHRASES, type AgentCapabilitySummary } from "./capabilities";
import { getRegisteredTools } from "@/lib/ai/tools/registry";
import { DEFAULT_AUTOMATION_LEVEL, type AutomationLevel } from "./policy";
import { assigneeLabel } from "@/lib/ai/tools/universal/lib/approval-resolve";
import type { ScopedClient } from "@/lib/supabase/scoped";
import type { IndustryId } from "@/industries/_registry";

export interface AgentFleetItem {
  id: string;
  agentKey: string;
  displayName: string;
  status: "active" | "paused";
  positionId: string | null;
  assignedRole: string;
  description: string;
  tasksCompleted: number;
  successRate: number | null; // null when the agent has produced zero outputs — render "—", never a fake 0/100
  lastActive: string | null; // ISO timestamp; humanize client-side
  createdAt: string;
  capabilities: AgentCapabilitySummary | null; // null when the registry def is missing (hired agent whose def was removed)
}

export interface AgentCatalogEntry {
  key: string;
  name: string;
  description: string;
  capabilities: AgentCapabilitySummary;
}

export interface AgentDetailStats {
  tasksCompleted: number;
  successRate: number | null;
  lastActive: string | null;
}

export interface AgentDetailRun {
  id: string;
  triggerEvent: string;
  subjectLabel: string | null;
  status: string;
  startedAt: string | null;
  finishedAt: string | null;
  durationMs: number | null;
  error: string | null;
}

export interface AgentDetailOutput {
  id: string;
  kind: string;
  status: string;
  createdAt: string;
  reviewedAt: string | null;
}

export interface AgentToolPolicyItem {
  toolId: string;
  label: string;
  automationLevel: AutomationLevel;
}

export interface AgentDetailWrite {
  id: string;
  toolId: string;
  input: unknown;
  result: unknown;
  status: string;
  createdAt: string;
  approvedBy: string | null;
  undone: boolean;
}

export interface AgentDetail {
  id: string;
  agentKey: string;
  displayName: string;
  status: "active" | "paused";
  positionName: string | null;
  createdAt: string;
  capabilities: AgentCapabilitySummary | null;
  stats: AgentDetailStats;
  recentRuns: AgentDetailRun[];
  recentOutputs: AgentDetailOutput[];
  /** Per-(agent, write tool) automation level — the Configure dialog's matrix (5.4d Part 5). Empty when the agent declares no write tools. */
  toolPolicies: AgentToolPolicyItem[];
  /** This agent's most recent executed writes, newest first — the drawer's "Actions taken" section (5.4d Part 6). */
  recentWrites: AgentDetailWrite[];
}

export interface AssignablePosition {
  id: string;
  name: string;
  base_tier: string;
}

export interface AgentReviewItem {
  id: string;
  kind: string;
  status: string;
  subjectType: string | null;
  subjectId: string | null;
  subjectLabel: string | null;
  agentId: string;
  agentName: string;
  payload: Record<string, unknown>;
  createdAt: string;
}

const ACCEPTED_OUTPUT_STATUSES = new Set(["accepted", "edited_accepted"]);

interface IdentityRow {
  id: string;
  agent_key: string;
  display_name: string;
  position_id: string | null;
  status: "active" | "paused";
  created_at: string;
}

interface RunRow {
  agent_id: string;
  status: string;
  started_at: string | null;
  finished_at: string | null;
}

interface OutputRow {
  agent_id: string;
  status: string;
}

interface PositionRow {
  id: string;
  name: string;
}

interface OutputQueueRow {
  id: string;
  agent_id: string;
  kind: string;
  status: string;
  subject_type: string | null;
  subject_id: string | null;
  payload: Record<string, unknown>;
  created_at: string;
}

interface AgentIdentityNameRow {
  id: string;
  display_name: string;
}

interface LeadLookupRow {
  id: string;
  first_name: string | null;
  last_name: string | null;
  email: string | null;
  display_id: string | null;
}

interface DetailRunRow {
  id: string;
  trigger_event: string;
  subject_type: string | null;
  subject_id: string | null;
  status: string;
  usage: Record<string, unknown> | null;
  error: string | null;
  started_at: string | null;
  finished_at: string | null;
}

interface DetailOutputRow {
  id: string;
  kind: string;
  status: string;
  created_at: string;
  reviewed_at: string | null;
}

interface WriteActionDetailRow {
  id: string;
  tool_id: string;
  input: unknown;
  result: unknown;
  status: string;
  user_id: string;
  created_at: string;
}

/**
 * Batched name resolution for ai_write_actions.user_id — mirrors
 * resolve-approval-refs' fetchAssigneeLabel: tenant-membership is checked
 * FIRST (`tenant_users`, one `.in()` query for every id at once) before any
 * name is trusted, since `auth.admin.getUserById` has no tenant concept of
 * its own — skipping the membership check would let a foreign tenant's user
 * id resolve to that user's real name. Bounded by the caller to the unique
 * approver ids among at most 20 rows (getAgentDetail's recentWrites cap), so
 * one getUserById per unique approver — not per row — is the batching this
 * needs; Supabase's admin API has no batch-by-ids lookup to call instead.
 */
async function resolveApprovedByNames(db: ScopedClient, userIds: string[]): Promise<Map<string, string>> {
  const names = new Map<string, string>();
  if (userIds.length === 0) return names;

  const { data: members } = await db.from("tenant_users").select("user_id").in("user_id", userIds);
  const memberIds = new Set(((members ?? []) as unknown as Array<{ user_id: string }>).map((m) => m.user_id));

  await Promise.all(
    [...memberIds].map(async (id) => {
      const { data } = await db.raw().auth.admin.getUserById(id);
      const user = data?.user;
      const meta = (user?.user_metadata ?? {}) as Record<string, unknown>;
      const name = (meta.name ?? meta.full_name ?? null) as string | null;
      names.set(id, assigneeLabel(name, user?.email ?? null));
    }),
  );
  return names;
}

function leadSubjectLabel(lead: LeadLookupRow): string {
  const name = [lead.first_name, lead.last_name].filter(Boolean).join(" ").trim();
  return name || lead.email || lead.display_id || "Lead";
}

/**
 * Real data for the /orca/agents Fleet screen (replaces the MOCK_AGENTS
 * placeholder). Rolls up agent_runs/agent_outputs in JS rather than SQL
 * aggregates — mirrors the positions/route.ts member-count idiom.
 */
export async function getAgentFleet(tenantId: string): Promise<AgentFleetItem[]> {
  const db = await scopedClientForTenant(tenantId);

  const { data: identities } = await db
    .from("agent_identities")
    .select("id, agent_key, display_name, position_id, status, created_at")
    .order("created_at", { ascending: true });

  const rows = (identities ?? []) as unknown as IdentityRow[];
  if (rows.length === 0) return [];

  const agentIds = rows.map((r) => r.id);
  const positionIds = [...new Set(rows.map((r) => r.position_id).filter((id): id is string => id !== null))];

  const [{ data: runs }, { data: outputs }, { data: positions }] = await Promise.all([
    db.from("agent_runs").select("agent_id, status, started_at, finished_at").in("agent_id", agentIds),
    db.from("agent_outputs").select("agent_id, status").in("agent_id", agentIds),
    positionIds.length > 0
      ? db.from("positions").select("id, name").in("id", positionIds)
      : Promise.resolve({ data: [] as PositionRow[] }),
  ]);

  const runsByAgent = new Map<string, { completed: number; last: string | null }>();
  // Only status === "completed" counts — NOT "awaiting_approval" (mig 190).
  // A run stuck awaiting a human decision on its write proposals hasn't
  // finished yet; counting it here would claim work that may still be
  // rejected or time out. Do not "fix" this to include awaiting_approval.
  for (const r of (runs ?? []) as unknown as RunRow[]) {
    const entry = runsByAgent.get(r.agent_id) ?? { completed: 0, last: null };
    if (r.status === "completed") entry.completed++;
    const activity = r.finished_at ?? r.started_at;
    if (activity && (!entry.last || activity > entry.last)) entry.last = activity;
    runsByAgent.set(r.agent_id, entry);
  }

  const outputsByAgent = new Map<string, { accepted: number; total: number }>();
  for (const o of (outputs ?? []) as unknown as OutputRow[]) {
    // Only REVIEWED outcomes count toward the denominator — 'proposed' rows are
    // still awaiting a human decision (not yet a success/failure signal) and
    // 'expired' rows were never decided either; counting them drags a fresh,
    // working agent's rate down toward 0% for no reason.
    if (o.status === "expired" || o.status === "proposed") continue;
    const entry = outputsByAgent.get(o.agent_id) ?? { accepted: 0, total: 0 };
    entry.total++;
    if (ACCEPTED_OUTPUT_STATUSES.has(o.status)) entry.accepted++;
    outputsByAgent.set(o.agent_id, entry);
  }

  const positionNameById = new Map(((positions ?? []) as unknown as PositionRow[]).map((p) => [p.id, p.name]));

  return rows.map((r) => {
    const runStats = runsByAgent.get(r.id);
    const outStats = outputsByAgent.get(r.id);
    const def = getAgentDefinition(r.agent_key);
    return {
      id: r.id,
      agentKey: r.agent_key,
      displayName: r.display_name,
      status: r.status,
      positionId: r.position_id,
      assignedRole: r.position_id ? (positionNameById.get(r.position_id) ?? "Unassigned") : "Unassigned",
      description: def?.description ?? "",
      tasksCompleted: runStats?.completed ?? 0,
      successRate: outStats && outStats.total > 0 ? Math.round((outStats.accepted / outStats.total) * 100) : null,
      lastActive: runStats?.last ?? null,
      createdAt: r.created_at,
      capabilities: def ? describeCapabilities(def) : null,
    };
  });
}

/**
 * Registry defs available to this tenant's industry (universal +
 * industry-matched) minus agent_keys already hired — what the "+ Add Agent"
 * dialog offers.
 */
export async function getAgentCatalog(tenantId: string, industryId: string | null): Promise<AgentCatalogEntry[]> {
  const db = await scopedClientForTenant(tenantId);
  const { data: hired } = await db.from("agent_identities").select("agent_key");
  const hiredKeys = new Set(((hired ?? []) as unknown as Array<{ agent_key: string }>).map((r) => r.agent_key));

  return getAgentDefinitionsForIndustry(industryId)
    .filter((d) => !hiredKeys.has(d.key))
    .map((d) => ({ key: d.key, name: d.name, description: d.description, capabilities: describeCapabilities(d) }));
}

/** Positions this tenant can assign a hired agent to — mirrors the api/v1/positions GET shape, trimmed to what the dialog needs. */
export async function getAssignablePositions(tenantId: string): Promise<AssignablePosition[]> {
  const db = await scopedClientForTenant(tenantId);
  const { data } = await db
    .from("positions")
    .select("id, name, base_tier")
    .order("base_tier", { ascending: true });
  return (data ?? []) as unknown as AssignablePosition[];
}

// 5.4d Defect A: a write_action_proposal draft resolved to automation_level
// "agent_human" already has a real agent_approvals row driving it (raised by
// runWriteApprovalGate) — it must surface in the Approvals section, not here,
// or an admin sees the same pending action twice with two different (one
// fake) accept paths. A "human_led" draft is different: loadAgentHumanWriteProposals
// only raises approvals for the agent_human tier, so a human_led draft has NO
// agent_approvals row at all — it's a legitimate suggestion ("the agent wanted
// to do X and isn't allowed to") and must keep appearing here. automation_level
// lives inside payload JSONB, so a column-level `.neq("kind", ...)` can't tell
// these two apart — the rows are fetched (this function already post-processes
// in JS below) and filtered here instead.
//
// This predicate and getPendingReviewCount's `.or("kind.neq.write_action_proposal,
// payload->>automation_level.neq.agent_human")` below encode the SAME exclusion
// rule twice — once in JS, once as a Postgres filter — and they diverge when
// payload.automation_level is absent: this JS check treats missing as "not
// agent_human" -> not excluded -> included in the queue, but Postgres's `<>`
// against a NULL jsonb field evaluates to NULL (not TRUE), so the `.or()` drops
// that row from the count -> the badge excludes it while the queue shows it.
// Not reachable today (every write_action_proposal payload sets automation_level),
// so left as-is rather than risking a behavior change; if you touch one of these
// two, touch the other so they stay in sync. See getPendingReviewCount below.
function isExcludedFromReviewQueue(row: OutputQueueRow): boolean {
  if (row.kind !== "write_action_proposal") return false;
  const payload = row.payload as { automation_level?: string } | null;
  return payload?.automation_level === "agent_human";
}

/**
 * Server query for the /orca/review human review surface — every
 * `agent_outputs` row still awaiting a decision, newest first, enriched
 * with the producing agent's display name and (for lead-subject outputs)
 * a human-readable label for the lead. Excludes agent_human-tier write
 * proposals — see isExcludedFromReviewQueue above (Defect A).
 */
export async function getReviewQueue(tenantId: string): Promise<AgentReviewItem[]> {
  const db = await scopedClientForTenant(tenantId);

  const { data: outputs } = await db
    .from("agent_outputs")
    .select("id, agent_id, kind, status, subject_type, subject_id, payload, created_at")
    .eq("status", "proposed")
    .order("created_at", { ascending: false });

  const rows = ((outputs ?? []) as unknown as OutputQueueRow[]).filter((r) => !isExcludedFromReviewQueue(r));
  if (rows.length === 0) return [];

  const agentIds = [...new Set(rows.map((r) => r.agent_id))];
  const leadIds = [
    ...new Set(
      rows
        .filter((r) => r.subject_type === "lead" && r.subject_id !== null)
        .map((r) => r.subject_id as string),
    ),
  ];

  const [{ data: identities }, { data: leads }] = await Promise.all([
    db.from("agent_identities").select("id, display_name").in("id", agentIds),
    leadIds.length > 0
      ? db.from("leads").select("id, first_name, last_name, email, display_id").in("id", leadIds)
      : Promise.resolve({ data: [] as LeadLookupRow[] }),
  ]);

  const agentNameById = new Map(
    ((identities ?? []) as unknown as AgentIdentityNameRow[]).map((a) => [a.id, a.display_name]),
  );
  const leadLabelById = new Map(
    ((leads ?? []) as unknown as LeadLookupRow[]).map((l) => [l.id, leadSubjectLabel(l)]),
  );

  return rows.map((r) => ({
    id: r.id,
    kind: r.kind,
    status: r.status,
    subjectType: r.subject_type,
    subjectId: r.subject_id,
    subjectLabel: r.subject_type === "lead" && r.subject_id ? (leadLabelById.get(r.subject_id) ?? null) : null,
    agentId: r.agent_id,
    agentName: agentNameById.get(r.agent_id) ?? "Unknown agent",
    payload: r.payload,
    createdAt: r.created_at,
  }));
}

export interface AgentApprovalItem {
  id: string;
  toolId: string;
  toolInput: unknown;
  runId: string;
  agentId: string;
  agentName: string;
  subjectType: string | null; // from the agent_runs row this approval's proposal came from
  subjectId: string | null;
  requestedAt: string;
  expiresAt: string;
}

interface ApprovalQueueRow {
  id: string;
  run_id: string;
  tool_id: string;
  tool_input: unknown;
  requested_at: string;
  expires_at: string;
}

interface RunContextRow {
  id: string;
  agent_id: string;
  subject_type: string | null;
  subject_id: string | null;
}

/**
 * Server query for the /orca/review approvals section — every `agent_approvals`
 * row still `pending`, newest first, enriched with the producing agent's
 * display name and the run's subject (agent_approvals itself carries no
 * agent_id — loadAgentRunContext's join, mirrored here in bulk to avoid N+1).
 */
export async function getPendingApprovals(tenantId: string): Promise<AgentApprovalItem[]> {
  const db = await scopedClientForTenant(tenantId);

  const { data: approvals } = await db
    .from("agent_approvals")
    .select("id, run_id, tool_id, tool_input, requested_at, expires_at")
    .eq("status", "pending")
    .order("requested_at", { ascending: false });

  const rows = (approvals ?? []) as unknown as ApprovalQueueRow[];
  if (rows.length === 0) return [];

  const runIds = [...new Set(rows.map((r) => r.run_id))];
  const { data: runs } = await db.from("agent_runs").select("id, agent_id, subject_type, subject_id").in("id", runIds);
  const runRows = (runs ?? []) as unknown as RunContextRow[];
  const runById = new Map(runRows.map((r) => [r.id, r]));

  const agentIds = [...new Set(runRows.map((r) => r.agent_id))];
  const { data: identities } =
    agentIds.length > 0
      ? await db.from("agent_identities").select("id, display_name").in("id", agentIds)
      : { data: [] as AgentIdentityNameRow[] };
  const agentNameById = new Map(
    ((identities ?? []) as unknown as AgentIdentityNameRow[]).map((a) => [a.id, a.display_name]),
  );

  const items: AgentApprovalItem[] = [];
  for (const r of rows) {
    // Defensive, not expected: agent_approvals.run_id is a NOT NULL FK to
    // agent_runs (mig 187) and both tables are fetched through the same
    // tenant-scoped client — a missing run row would mean a data
    // inconsistency, not a normal case. Skip rather than render a broken row.
    const run = runById.get(r.run_id);
    if (!run) continue;
    items.push({
      id: r.id,
      toolId: r.tool_id,
      toolInput: r.tool_input,
      runId: r.run_id,
      agentId: run.agent_id,
      agentName: agentNameById.get(run.agent_id) ?? "Unknown agent",
      subjectType: run.subject_type,
      subjectId: run.subject_id,
      requestedAt: r.requested_at,
      expiresAt: r.expires_at,
    });
  }
  return items;
}

/**
 * Count of items still awaiting a human decision on /orca/review — the sum
 * of pending suggestions (agent_outputs, minus the agent_human write
 * proposals excluded per isExcludedFromReviewQueue/Defect A — those are
 * counted via agent_approvals instead, never both) and pending approvals
 * (agent_approvals). Drives the /orca Review nav badge; under-reporting the
 * approvals half would hide the more consequential decisions.
 *
 * The `.or(...)` below re-encodes isExcludedFromReviewQueue's rule as a
 * Postgres filter instead of reusing the JS predicate (this query only
 * wants a `head: true` count, not the rows) — see that function's docstring
 * for how the two diverge on a missing automation_level and why it's left
 * alone. Keep the two in sync if either changes.
 */
export async function getPendingReviewCount(tenantId: string): Promise<number> {
  const db = await scopedClientForTenant(tenantId);
  const [{ count: suggestionsCount }, { count: approvalsCount }] = await Promise.all([
    db
      .from("agent_outputs")
      .select("*", { count: "exact", head: true })
      .eq("status", "proposed")
      .or("kind.neq.write_action_proposal,payload->>automation_level.neq.agent_human"),
    db.from("agent_approvals").select("*", { count: "exact", head: true }).eq("status", "pending"),
  ]);
  return (suggestionsCount ?? 0) + (approvalsCount ?? 0);
}

/**
 * Server query for the Agent Detail drawer — one hired agent's capability
 * summary, lifetime stats (same rollup math as getAgentFleet, computed over
 * this agent's full run/output history), and its most recent 20 runs/outputs
 * for the "what it's done" timeline. Returns null when the id isn't a hired
 * agent in this tenant (cross-tenant or unknown id).
 */
export async function getAgentDetail(
  tenantId: string,
  agentId: string,
  industryId: string | null,
): Promise<AgentDetail | null> {
  const db = await scopedClientForTenant(tenantId);

  const { data: identity } = await db
    .from("agent_identities")
    .select("id, agent_key, display_name, position_id, status, created_at")
    .eq("id", agentId)
    .maybeSingle();

  const row = identity as unknown as IdentityRow | null;
  if (!row) return null;

  const def = getAgentDefinition(row.agent_key);
  // The registry's own scope for each tool this agent declares — a write
  // tool id no longer implies "draft-only" (5.4a), so the matrix only ever
  // lists real scope:"write" registry tools, never draft-tool ids. Also
  // applies the same industry predicate buildAgentToolset (runtime.ts) uses
  // at execution time (Phase 6 slice 6.1 Part 2) — without it the matrix
  // offered a control for a tool the agent's own runtime toolset would never
  // include for this tenant's industry (e.g. update_lead_stage, education-only,
  // shown to an it_agency tenant).
  const writeToolIds = (def?.toolIds ?? []).filter((id) => {
    const t = getRegisteredTools().find((tool) => tool.id === id);
    if (!t || t.scope !== "write") return false;
    if (t.industries !== undefined) {
      if (industryId === null) return false;
      if (!t.industries.includes(industryId as IndustryId)) return false;
    }
    return true;
  });

  const [{ data: position }, { data: runs }, { data: outputs }, { data: policies }, { data: writes }] = await Promise.all([
    row.position_id
      ? db.from("positions").select("id, name").eq("id", row.position_id).maybeSingle()
      : Promise.resolve({ data: null as PositionRow | null }),
    db
      .from("agent_runs")
      .select("id, trigger_event, subject_type, subject_id, status, usage, error, started_at, finished_at")
      .eq("agent_id", agentId)
      .order("started_at", { ascending: false }),
    db
      .from("agent_outputs")
      .select("id, kind, status, created_at, reviewed_at")
      .eq("agent_id", agentId)
      .order("created_at", { ascending: false }),
    writeToolIds.length > 0
      ? db.from("agent_tool_policies").select("tool_id, automation_level").eq("agent_id", agentId)
      : Promise.resolve({ data: [] as Array<{ tool_id: string; automation_level: AutomationLevel }> }),
    // undo_of IS NULL excludes the undo actions themselves (both the in-chat
    // undo_lead_action tool and the agent-writes undo route insert their own
    // executed row, tool_id equal to the ORIGINAL action's, undo_of = the
    // original row's id). Without this filter an undone action shows twice —
    // once correctly, once as a second "Agent action · approved by <the
    // admin who clicked Undo>" row whose own Undo button always 422s (its
    // result has no `previous` snapshot to restore from, only `restored`).
    db
      .from("ai_write_actions")
      .select("id, tool_id, input, result, status, user_id, created_at")
      .eq("agent_id", agentId)
      .eq("status", "executed")
      .is("undo_of", null)
      .order("created_at", { ascending: false })
      .limit(20),
  ]);

  const runRows = (runs ?? []) as unknown as DetailRunRow[];
  const outputRows = (outputs ?? []) as unknown as DetailOutputRow[];
  const policyByToolId = new Map(
    ((policies ?? []) as unknown as Array<{ tool_id: string; automation_level: AutomationLevel }>).map((p) => [
      p.tool_id,
      p.automation_level,
    ]),
  );
  const toolPolicies: AgentToolPolicyItem[] = writeToolIds.map((toolId) => ({
    toolId,
    label: WRITE_TOOL_PHRASES[toolId] ?? toolId,
    automationLevel: policyByToolId.get(toolId) ?? DEFAULT_AUTOMATION_LEVEL,
  }));

  // Stats roll up over the FULL history (mirrors getAgentFleet's math); the
  // timeline below only shows the most recent slice of that same data.
  let tasksCompleted = 0;
  let lastActive: string | null = null;
  // Only status === "completed" counts — see the identical comment in
  // getAgentFleet above; the two rollups must not drift.
  for (const r of runRows) {
    if (r.status === "completed") tasksCompleted++;
    const activity = r.finished_at ?? r.started_at;
    if (activity && (!lastActive || activity > lastActive)) lastActive = activity;
  }
  let accepted = 0;
  let reviewed = 0;
  for (const o of outputRows) {
    if (o.status === "expired" || o.status === "proposed") continue;
    reviewed++;
    if (ACCEPTED_OUTPUT_STATUSES.has(o.status)) accepted++;
  }

  const recentRunRows = runRows.slice(0, 20);
  const recentOutputRows = outputRows.slice(0, 20);

  const leadIds = [
    ...new Set(
      recentRunRows
        .filter((r) => r.subject_type === "lead" && r.subject_id !== null)
        .map((r) => r.subject_id as string),
    ),
  ];
  const { data: leads } =
    leadIds.length > 0
      ? await db.from("leads").select("id, first_name, last_name, email, display_id").in("id", leadIds)
      : { data: [] as LeadLookupRow[] };
  const leadLabelById = new Map(
    ((leads ?? []) as unknown as LeadLookupRow[]).map((l) => [l.id, leadSubjectLabel(l)]),
  );

  const writeRows = (writes ?? []) as unknown as WriteActionDetailRow[];
  const writeIds = writeRows.map((w) => w.id);
  const approverIds = [...new Set(writeRows.map((w) => w.user_id))];

  const [approvedByName, { data: undoRows }] = await Promise.all([
    resolveApprovedByNames(db, approverIds),
    // undo_lead_action/agent-writes-undo route both write undo rows with
    // undo_of = the target's id and status 'executed' once the undo actually
    // ran — one batched query instead of N.
    writeIds.length > 0
      ? db.from("ai_write_actions").select("undo_of").in("undo_of", writeIds).eq("status", "executed")
      : Promise.resolve({ data: [] as Array<{ undo_of: string | null }> }),
  ]);
  const undoneSet = new Set(
    ((undoRows ?? []) as unknown as Array<{ undo_of: string | null }>)
      .map((r) => r.undo_of)
      .filter((id): id is string => id !== null),
  );

  const recentWrites: AgentDetailWrite[] = writeRows.map((w) => ({
    id: w.id,
    toolId: w.tool_id,
    input: w.input,
    result: w.result,
    status: w.status,
    createdAt: w.created_at,
    approvedBy: approvedByName.get(w.user_id) ?? null,
    undone: undoneSet.has(w.id),
  }));

  return {
    id: row.id,
    agentKey: row.agent_key,
    displayName: row.display_name,
    status: row.status,
    positionName: (position as unknown as PositionRow | null)?.name ?? null,
    createdAt: row.created_at,
    capabilities: def ? describeCapabilities(def) : null,
    toolPolicies,
    stats: {
      tasksCompleted,
      successRate: reviewed > 0 ? Math.round((accepted / reviewed) * 100) : null,
      lastActive,
    },
    recentRuns: recentRunRows.map((r) => ({
      id: r.id,
      triggerEvent: r.trigger_event,
      subjectLabel: r.subject_type === "lead" && r.subject_id ? (leadLabelById.get(r.subject_id) ?? null) : null,
      status: r.status,
      startedAt: r.started_at,
      finishedAt: r.finished_at,
      durationMs: typeof r.usage?.duration_ms === "number" ? (r.usage.duration_ms as number) : null,
      error: r.error,
    })),
    recentOutputs: recentOutputRows.map((o) => ({
      id: o.id,
      kind: o.kind,
      status: o.status,
      createdAt: o.created_at,
      reviewedAt: o.reviewed_at,
    })),
    recentWrites,
  };
}
