// Pure "Accept this chat" rules: no server code, no imports. Safe for BOTH the API routes and the browser screens.
// src/lib/inbox/claim.ts re-exports these and adds the server-only helpers (database, notes, replyLock).

/**
 * Channels whose conversations must be ACCEPTED before anyone can reply. Website chat only for now
 * (its provider id is "chatwoot"). Adding WhatsApp / Messenger / Instagram later is one line here.
 * Every other channel keeps today's behaviour exactly.
 */
export const CLAIM_PROVIDERS: ReadonlySet<string> = new Set(["chatwoot"]);

export function requiresClaim(provider: string | null | undefined): boolean {
  return !!provider && CLAIM_PROVIDERS.has(provider);
}

export interface ClaimState {
  provider: string | null;
  assignee_type: string | null;
  assigned_to_user_id: string | null;
}

/**
 * The user who owns the conversation, or null when nobody does. A "human" assignee whose user was deleted
 * (assigned_to_user_id set null by the FK) counts as nobody, so that chat can be accepted again instead of
 * being stuck on a person who no longer exists.
 */
export function ownerOf(c: Pick<ClaimState, "assignee_type" | "assigned_to_user_id">): string | null {
  return c.assignee_type === "human" && c.assigned_to_user_id ? c.assigned_to_user_id : null;
}

/** May this user send a reply? Channels that don't need accepting are unchanged: anyone who could reply before still can. */
export function canReply(c: ClaimState, userId: string): boolean {
  if (!requiresClaim(c.provider)) return true;
  return ownerOf(c) === userId;
}

/**
 * The PostgREST `.or()` filter for "nobody owns this conversation": unassigned, or a human assignee whose user was
 * deleted (so the chat is not stuck on someone who no longer exists). Matches ownerOf() === null. One string, used by the
 * Accept route (so only an ownerless chat can be accepted) and the waiting-chats list.
 */
export const OWNERLESS_FILTER = "assignee_type.eq.unassigned,and(assignee_type.eq.human,assigned_to_user_id.is.null)";

/**
 * How recent a visitor's unanswered message must be for the chat to POP UP. Older waiting chats stay in the Inbox under
 * "Waiting to accept", but don't ambush everyone. (The day this ships, every old website chat nobody ever "accepted"
 * is technically waiting; without this window all of them would pop up at once.)
 */
export const POPUP_WINDOW_HOURS = 24;
