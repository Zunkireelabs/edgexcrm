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
    if (o.status === "expired") continue; // excluded from the acceptance-rate denominator
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
