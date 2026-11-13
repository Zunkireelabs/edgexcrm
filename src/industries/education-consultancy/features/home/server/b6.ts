import { branchMemberIds } from "@/lib/leads/branch-membership";
import type { HomeDb } from "./load-home";
import type { ScopedLeads } from "./lead-scope";
import { AGENT_REVIEW_HREF, type AgentDraftSummary } from "../lib/agent-drafts";
import type { OrcaDraftCounts } from "../lib/impact";

const CHUNK = 100;
function chunk<T>(xs: T[], n = CHUNK): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < xs.length; i += n) out.push(xs.slice(i, i + n));
  return out;
}

/**
 * Proposed MESSAGE drafts from agents (agent_outputs: kind draft_email, status proposed), in the viewer's scope:
 *   - tenant scope (owner / admin on "Overall"): every one in the tenant;
 *   - a branch (pinned manager, or the owner's header picker): only drafts whose subject lead is in that scope, by the SAME lead-scope
 *     definition the rest of Home uses (leadScope), so a branch manager never counts another branch's drafts.
 * Null when there are none: the row has no empty state.
 */
export async function loadAgentDrafts(db: HomeDb, leadScope: ScopedLeads): Promise<AgentDraftSummary | null> {
  const { data, error } = await db.from("agent_outputs").select("id, agent_id, subject_type, subject_id").eq("status", "proposed").eq("kind", "draft_email").limit(500);
  if (error) return null;
  let rows = (data ?? []) as unknown as Array<{ id: string; agent_id: string; subject_type: string | null; subject_id: string | null }>;
  if (rows.length === 0) return null;
  if (leadScope.definition !== "tenant") {
    const subjectIds = [...new Set(rows.filter((r) => r.subject_type === "lead" && r.subject_id).map((r) => r.subject_id as string))];
    const inScope = new Set<string>();
    for (const ids of chunk(subjectIds)) {
      const { data: ls } = await leadScope.select("id").in("id", ids).is("deleted_at", null);
      for (const l of (ls ?? []) as unknown as Array<{ id: string }>) inScope.add(l.id);
    }
    rows = rows.filter((r) => r.subject_type === "lead" && r.subject_id && inScope.has(r.subject_id));
    if (rows.length === 0) return null;
  }
  const byAgent = new Map<string, number>();
  for (const r of rows) byAgent.set(r.agent_id, (byAgent.get(r.agent_id) ?? 0) + 1);
  const topAgent = [...byAgent.entries()].sort((a, b) => b[1] - a[1])[0][0];
  const { data: agent } = await db.from("agent_identities").select("display_name").eq("id", topAgent).maybeSingle();
  return { count: rows.length, agentName: (agent as unknown as { display_name: string } | null)?.display_name ?? "Orca agent", reviewHref: AGENT_REVIEW_HREF };
}

/**
 * How the person finished the Orca message drafts (Draft panel + Prepare all) in a window: sent_as_is / edited / discarded, from
 * `ai_drafts`. A branch manager sees only their own branch's counsellors (the branch members), an owner on "Overall" everyone.
 */
export async function loadOrcaDraftCounts(db: HomeDb, tenantId: string, window: { from: Date; to: Date }, branchId: string | null): Promise<OrcaDraftCounts> {
  const members = branchId ? await branchMemberIds(db.raw(), tenantId, branchId) : null;
  if (members && members.length === 0) return { sent: 0, edited: 0, discarded: 0 };
  let q = db
    .from("ai_drafts")
    .select("outcome")
    .in("surface", ["home_draft", "home_batch"])
    .in("outcome", ["sent_as_is", "edited", "discarded"])
    .gte("resolved_at", window.from.toISOString())
    .lt("resolved_at", window.to.toISOString())
    .limit(10000);
  if (members) q = q.in("user_id", members);
  const { data, error } = await q;
  const c: OrcaDraftCounts = { sent: 0, edited: 0, discarded: 0 };
  if (error) return c;
  for (const r of (data ?? []) as unknown as Array<{ outcome: string }>) {
    if (r.outcome === "sent_as_is") c.sent++;
    else if (r.outcome === "edited") c.edited++;
    else if (r.outcome === "discarded") c.discarded++;
  }
  return c;
}
