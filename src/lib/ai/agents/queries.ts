import { scopedClientForTenant } from "@/lib/supabase/scoped";
import { getAgentDefinition, getAgentDefinitionsForIndustry } from "./registry";

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
}

export interface AgentCatalogEntry {
  key: string;
  name: string;
  description: string;
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
    .map((d) => ({ key: d.key, name: d.name, description: d.description }));
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

/**
 * Server query for the /orca/review human review surface — every
 * `agent_outputs` row still awaiting a decision, newest first, enriched
 * with the producing agent's display name and (for lead-subject outputs)
 * a human-readable label for the lead.
 */
export async function getReviewQueue(tenantId: string): Promise<AgentReviewItem[]> {
  const db = await scopedClientForTenant(tenantId);

  const { data: outputs } = await db
    .from("agent_outputs")
    .select("id, agent_id, kind, status, subject_type, subject_id, payload, created_at")
    .eq("status", "proposed")
    .order("created_at", { ascending: false });

  const rows = (outputs ?? []) as unknown as OutputQueueRow[];
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

/** Count of `agent_outputs` rows still awaiting review — drives the /orca Review nav badge. */
export async function getPendingReviewCount(tenantId: string): Promise<number> {
  const db = await scopedClientForTenant(tenantId);
  const { count } = await db
    .from("agent_outputs")
    .select("*", { count: "exact", head: true })
    .eq("status", "proposed");
  return count ?? 0;
}
