import type { SupabaseClient } from "@supabase/supabase-js";
import { leadQueryScope, type LeadQueryScope, type ResolvedPermissions } from "@/lib/api/permissions";
import { visibleLeadsBase } from "@/lib/leads/visibility-query";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = SupabaseClient<any>;

/**
 * Shared scoping for every inbox conversation surface (the list route, the 3
 * single-conversation routes, and the /inbox page) so "what can this caller see" is
 * computed exactly once and can never drift between them — closing the "list shows
 * it, detail 404s" bug class these routes used to be exposed to. Every function here
 * is a thin wrapper over the same primitives the rest of the app already uses for
 * lead visibility (leadQueryScope / visibleLeadsBase), not a new scoping mechanism.
 *
 * Minimal auth shape (mirrors branch-membership.ts's BranchManageAuth) so both the
 * API routes (which have a full AuthContext) and the server-rendered /inbox page
 * (which only has getCurrentUserTenant()'s narrower shape) can call these without
 * constructing a fake AuthContext.
 */
export interface InboxScopeAuth {
  tenantId: string;
  userId: string;
  branchId: string | null;
  permissions: ResolvedPermissions;
}

export interface InboxScopeClients {
  /** RLS-context client (createClient()) — visibleLeadsBase's own/branch RPC branches
   * are SECURITY DEFINER and fail closed to zero rows without a real auth.uid(). */
  user: Db;
  /** Service client, already the caller's source of truth for `conversations`/`leads`. */
  service: Db;
}

export function resolveInboxLeadScope(auth: InboxScopeAuth): LeadQueryScope {
  return leadQueryScope(auth.permissions, auth.userId, auth.branchId);
}

/** True for counselor (own) and branch manager (team, incl. the §4.1 NULL-branch
 * fallback) — every scope that must not see the whole tenant. False for owner/admin
 * and any leadScope:"all" position, which stay fully unrestricted (unchanged today). */
export function isInboxScopeRestricted(scope: LeadQueryScope): boolean {
  return scope.restrictToSelf || !!scope.branchId;
}

/**
 * Which of `candidateLeadIds` can `scope`'s holder actually see? Always resolved via
 * visibleLeadsBase so list and detail agree by construction — never re-derive "own"/
 * "branch" membership by hand here.
 *
 * Callers MUST only reach this when the scope is actually restricted (see
 * isInboxScopeRestricted) — for an unrestricted scope, visibleLeadsBase's own
 * fallback branch already hardcodes `.select("*").eq(...)`, which a second
 * `.select("id")` here cannot chain onto cleanly (same caveat as the leads route's
 * own comment on this). Calling this with an unrestricted scope is a caller bug, not
 * live input, so it throws instead of silently returning a wrong result.
 */
export async function visibleLeadIdsAmong(
  clients: InboxScopeClients,
  tenantId: string,
  scope: LeadQueryScope,
  candidateLeadIds: string[],
): Promise<string[]> {
  if (!isInboxScopeRestricted(scope)) {
    throw new Error("visibleLeadIdsAmong: scope is unrestricted — caller should skip filtering entirely");
  }
  if (candidateLeadIds.length === 0) return [];
  const { data } = await visibleLeadsBase(clients, tenantId, scope)
    .select("id")
    .is("deleted_at", null)
    .in("id", candidateLeadIds);
  return ((data ?? []) as { id: string }[]).map((r) => r.id);
}

/**
 * Single-conversation access check for the 3 detail routes ([id], messages, draft).
 * Unlinked conversations (leadId null) are visible only to an unrestricted caller
 * (owner/admin, or a leadScope:"all" position) — a deliberate existing product
 * decision (docs/UNIFIED-INBOX-BRIEF.md), left unchanged here.
 */
export async function canAccessConversationLead(
  clients: InboxScopeClients,
  auth: InboxScopeAuth,
  leadId: string | null,
): Promise<boolean> {
  const scope = resolveInboxLeadScope(auth);
  if (!isInboxScopeRestricted(scope)) return true;
  if (!leadId) return false;
  const ids = await visibleLeadIdsAmong(clients, auth.tenantId, scope, [leadId]);
  return ids.length > 0;
}
