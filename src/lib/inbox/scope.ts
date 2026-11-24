import type { SupabaseClient } from "@supabase/supabase-js";
import { leadQueryScope, type LeadQueryScope, type ResolvedPermissions } from "@/lib/api/permissions";
import { visibleLeadsBase } from "@/lib/leads/visibility-query";
import { CLAIM_PROVIDERS, requiresClaim } from "@/lib/inbox/claim";
import { canSeeNav } from "@/lib/api/permissions";

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
  provider?: string | null,
): Promise<boolean> {
  const scope = resolveInboxLeadScope(auth);
  if (!isInboxScopeRestricted(scope)) return true;
  // Website chats (the ones that must be accepted) are readable by EVERY Inbox user, whoever the lead belongs to:
  // that is what lets the first free person see a waiting chat and accept it. Other channels keep the lead rules.
  if (requiresClaim(provider) && canSeeNav(auth.permissions, "/inbox")) return true;
  if (!leadId) return false;
  const ids = await visibleLeadIdsAmong(clients, auth.tenantId, scope, [leadId]);
  return ids.length > 0;
}

/**
 * The `.or()` filter for a RESTRICTED viewer's conversation list: conversations on leads they can see, PLUS every
 * website chat (when they can open the Inbox at all). One function, used by the list route and the /inbox page, so
 * the two can never show different sets. `visibleLeadIds` may be empty; the website-chat part still applies.
 * Returns null when the viewer would see nothing (no visible leads and no Inbox access), so callers can skip the query.
 */
export function restrictedConversationFilter(visibleLeadIds: string[], canOpenInbox: boolean): string | null {
  const parts: string[] = [];
  if (visibleLeadIds.length > 0) parts.push(`lead_id.in.(${visibleLeadIds.join(",")})`);
  if (canOpenInbox) parts.push(`provider.in.(${[...CLAIM_PROVIDERS].join(",")})`);
  return parts.length > 0 ? parts.join(",") : null;
}

/**
 * Website chats are readable by every Inbox user, but the lead a chat happens to be linked to is still that lead's
 * owner's business. May this viewer see the linked lead's details (name, email, phone)? Unrestricted viewers always;
 * a chat with no lead has nothing to hide; a restricted viewer only if the lead is one they can see.
 */
export async function canSeeLinkedLead(
  clients: InboxScopeClients,
  auth: InboxScopeAuth,
  leadId: string | null,
): Promise<boolean> {
  if (!leadId) return true;
  const scope = resolveInboxLeadScope(auth);
  if (!isInboxScopeRestricted(scope)) return true;
  const ids = await visibleLeadIdsAmong(clients, auth.tenantId, scope, [leadId]);
  return ids.length > 0;
}
