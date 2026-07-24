import { scopedClientForTenant } from "@/lib/supabase/scoped";
import { resolvePermissions, type ResolvedPermissions, type PositionPermissions } from "@/lib/api/permissions";
import type { AuthContext } from "@/lib/api/auth";

/**
 * Mirrors AuthContext for background agents (ADR-001 Decision 2, autonomous
 * mode): built server-side from an agent_identities row instead of a session.
 * No auth.users row exists for an agent — actorType distinguishes it wherever
 * AuthContext | AgentAuthContext is accepted.
 */
export interface AgentAuthContext {
  actorType: "agent";
  agentId: string;
  tenantId: string;
  industryId: string | null;
  positionId: string | null;
  permissions: ResolvedPermissions;
  role: "agent";
}

// Fail-safe grant for an agent with no position (or a deleted/dangling
// position_id): no cross-scope read, no write-adjacent grants. An agent must
// never default to broad access — this is the security boundary this module
// exists to enforce.
const MOST_RESTRICTIVE_PERMISSIONS: ResolvedPermissions = {
  baseTier: "member",
  allowedNavKeys: new Set(),
  pipelineAccess: { ids: new Set() },
  listAccess: { ids: new Set() },
  leadScope: "own",
  sharedPoolListIds: new Set(),
  canAssignLeads: false,
  canEditLeads: false,
  canManageApplications: false,
  canManageClasses: false,
  canManageHR: false,
  canExport: false,
  dashboardWidgets: new Set(),
};

interface AgentIdentityRow {
  position_id: string | null;
}

interface PositionRow {
  permissions: PositionPermissions;
}

/**
 * Loads the agent_identities row and resolves its position's permissions.
 * tenantId comes from the caller (the triggering event/run, never model
 * input) — same userless-seam convention as scopedClientForTenant itself.
 * Returns null only when the agent identity itself can't be found; a missing
 * or dangling position resolves to MOST_RESTRICTIVE_PERMISSIONS rather than
 * failing, so a misconfigured agent is locked down, not broken.
 */
export async function buildAgentAuthContext(
  agentId: string,
  tenantId: string,
): Promise<AgentAuthContext | null> {
  const db = await scopedClientForTenant(tenantId);

  const { data: agentData } = await db
    .from("agent_identities")
    .select("position_id")
    .eq("id", agentId)
    .maybeSingle();
  const agent = agentData as AgentIdentityRow | null;
  if (!agent) return null;

  const { data: tenantData } = await db
    .fromGlobal("tenants")
    .select("industry_id")
    .eq("id", tenantId)
    .maybeSingle();
  const industryId = (tenantData as { industry_id: string | null } | null)?.industry_id ?? null;

  if (!agent.position_id) {
    return {
      actorType: "agent",
      agentId,
      tenantId,
      industryId,
      positionId: null,
      permissions: MOST_RESTRICTIVE_PERMISSIONS,
      role: "agent",
    };
  }

  const { data: positionData } = await db
    .from("positions")
    .select("permissions")
    .eq("id", agent.position_id)
    .maybeSingle();
  const position = positionData as PositionRow | null;

  // "viewer" (never "owner"/"admin") so resolvePermissions() always reads the
  // position's JSON and never hits the owner/admin hard-override — a
  // background agent must never inherit god-mode from a position's tier.
  // Broad access stays grantable, but only by explicit JSON, never by tier
  // (Sadin, 2026-07-23).
  const permissions = position?.permissions
    ? resolvePermissions("viewer", position.permissions)
    : MOST_RESTRICTIVE_PERMISSIONS;

  return {
    actorType: "agent",
    agentId,
    tenantId,
    industryId,
    positionId: agent.position_id,
    permissions,
    role: "agent",
  };
}

/**
 * Phase 5.1a ships AgentAuthContext everywhere ToolContext.auth is read, but
 * no tool yet knows how to apply an agent's position-based scoping in place
 * of a real session's (that lands in 5.1b — doc 03 §1: "Tools that apply
 * counselor-style user scoping treat agents by their position permissions
 * instead"). Call at the top of any tool/wrapper that still assumes a real
 * user session so an agent invocation fails loudly today instead of silently
 * reading undefined session-only fields once agents start calling tools.
 */
export function assertUserAuth(auth: AuthContext | AgentAuthContext): asserts auth is AuthContext {
  if ("actorType" in auth) {
    throw new Error("This tool does not yet support execution under an agent identity (Phase 5.1b).");
  }
}
