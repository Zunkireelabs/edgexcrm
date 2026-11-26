import type { SupabaseClient } from "@supabase/supabase-js";
import { apiError } from "@/lib/api/response";
import { canSeeNav, positionPermissionsFromEmbed, resolvePermissions } from "@/lib/api/permissions";
import type { UserRole } from "@/types/database";
import { logger } from "@/lib/logger";
import { canReply, ownerOf, requiresClaim, type ClaimState } from "./claim-rules";

// "Accept this chat": ONE person owns a conversation and is the only one who can reply, so a visitor never
// gets two different answers. Everyone else can read it; the owner hands it over, or an admin takes over.
//
// This file is the single place that decides the rules. The routes (claim / handover / messages / draft /
// PATCH) and, later, the screens all ask these functions instead of re-deriving them, so they cannot drift.
//
// The owner lives in the columns every conversation already has (assignee_type + assigned_to_user_id, mig 044),
// so there is no migration.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = SupabaseClient<any>;

export { CLAIM_PROVIDERS, requiresClaim, ownerOf, canReply } from "./claim-rules";
export type { ClaimState } from "./claim-rules";

/** Tidy a person's name for a note: no control characters or angle brackets, trimmed and capped. */
function cleanName(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const cleaned = raw.replace(/[\u0000-\u001f<>]/g, " ").replace(/\s+/g, " ").trim().slice(0, 60);
  return cleaned.length > 0 ? cleaned : null;
}

/**
 * A person's name for the grey notes and the "Manish is handling this chat" message: their profile name,
 * else the part of their email before the @, else a neutral fallback. Never throws.
 */
export async function displayNameFor(db: Db, userId: string): Promise<string> {
  try {
    const { data } = await db.auth.admin.getUserById(userId);
    const user = data?.user;
    const meta = user?.user_metadata as Record<string, unknown> | undefined;
    const fromMeta = cleanName(meta?.name) ?? cleanName(meta?.full_name);
    if (fromMeta) return fromMeta;
    const local = user?.email ? cleanName(user.email.split("@")[0]) : null;
    if (local) return local;
  } catch (err) {
    logger.warn({ err }, "claim: could not look up a display name");
  }
  return "a teammate";
}

/**
 * Can this member open the Inbox? Same rule that hides the sidebar link (their position's allowed pages), so a
 * chat is never handed to someone who couldn't even see it. Suspended members and non-members can't.
 */
export async function memberCanOpenInbox(db: Db, tenantId: string, userId: string): Promise<boolean> {
  const { data } = await db
    .from("tenant_users")
    .select("role, suspended_at, positions(permissions)")
    .eq("tenant_id", tenantId)
    .eq("user_id", userId)
    .maybeSingle();
  if (!data) return false;
  return rowCanOpenInbox(data as MemberRow);
}

interface MemberRow {
  user_id?: string;
  role: string;
  suspended_at: string | null;
  positions: unknown;
}

/** The one rule: not suspended, and their position (or role) lets them open the Inbox. */
function rowCanOpenInbox(row: MemberRow): boolean {
  if (row.suspended_at) return false;
  const perms = resolvePermissions(row.role as UserRole, positionPermissionsFromEmbed(row.positions));
  return canSeeNav(perms, "/inbox");
}

/** Everyone in the tenant who can open the Inbox: who gets a "new website chat" alert and who can be handed a chat. */
export async function listInboxMemberIds(db: Db, tenantId: string): Promise<string[]> {
  const { data } = await db
    .from("tenant_users")
    .select("user_id, role, suspended_at, positions(permissions)")
    .eq("tenant_id", tenantId);
  return ((data ?? []) as MemberRow[]).filter(rowCanOpenInbox).map((r) => r.user_id as string);
}

/** The people a chat can be handed to: Inbox members with a readable name, sorted by name. */
export async function inboxMemberDirectory(db: Db, tenantId: string): Promise<{ user_id: string; name: string }[]> {
  const ids = await listInboxMemberIds(db, tenantId);
  if (ids.length === 0) return [];
  const wanted = new Set(ids);
  const { data } = await db.auth.admin.listUsers({ perPage: 1000 });
  const out: { user_id: string; name: string }[] = [];
  for (const u of data?.users ?? []) {
    if (!wanted.has(u.id)) continue;
    const meta = u.user_metadata as Record<string, unknown> | undefined;
    const name = cleanName(meta?.name) ?? cleanName(meta?.full_name) ?? (u.email ? cleanName(u.email.split("@")[0]) : null) ?? "Teammate";
    out.push({ user_id: u.id, name });
  }
  return out.sort((a, b) => a.name.localeCompare(b.name));
}

export interface SystemNoteInput {
  tenantId: string;
  conversationId: string;
  channelId: string;
  /** The person the note is about (who accepted / handed over); null if none. */
  userId: string | null;
  text: string;
}

/**
 * Adds a small grey line to the chat ("Manish accepted this chat"). It is written straight into `messages`,
 * NEVER through sendMessage(): sendMessage always calls the channel provider (the visitor would receive it) and
 * rewrites the conversation's last-message preview. A system note is team-only. Non-fatal: the ownership change
 * has already happened, so a failed note is logged, not raised.
 */
export async function writeSystemNote(db: Db, note: SystemNoteInput): Promise<void> {
  const { error } = await db.from("messages").insert({
    tenant_id: note.tenantId,
    conversation_id: note.conversationId,
    channel_id: note.channelId,
    direction: "outbound",
    author_type: "system",
    author_user_id: note.userId,
    content_text: note.text,
    status: "sent",
  });
  if (error) {
    logger.warn({ err: error, conversation_id: note.conversationId }, "claim: failed to write the system note (non-fatal)");
  }
}

/**
 * Used by the two reply routes (messages, draft). Returns null when this user may reply, otherwise a ready-made
 * 403 saying who is handling the chat. Channels that don't need accepting always return null.
 */
export async function replyLock(db: Db, conv: ClaimState, userId: string): Promise<Response | null> {
  if (canReply(conv, userId)) return null;
  const owner = ownerOf(conv);
  if (!owner) {
    return apiError("NOT_CHAT_OWNER", "Nobody is handling this chat yet. Accept it to reply.", 403);
  }
  const name = await displayNameFor(db, owner);
  return apiError("NOT_CHAT_OWNER", `${name} is handling this chat. Ask them to hand it over to reply.`, 403, { owner_id: owner });
}

/**
 * Used by PATCH /conversations/[id] (close, snooze, tag, link a lead...). Read-only for everyone but the owner means
 * read-only: on a website chat only the person handling it, or an owner/admin, may change it. Returns null when allowed,
 * otherwise a ready-made 403. Channels that don't need accepting are unchanged.
 */
export async function chatChangeLock(db: Db, conv: ClaimState, userId: string, isAdmin: boolean): Promise<Response | null> {
  if (!requiresClaim(conv.provider) || isAdmin) return null;
  const owner = ownerOf(conv);
  if (owner === userId) return null;
  if (!owner) {
    return apiError("NOT_CHAT_OWNER", "Accept this chat first to make changes to it.", 403);
  }
  const name = await displayNameFor(db, owner);
  return apiError("NOT_CHAT_OWNER", `${name} is handling this chat, so only they or an admin can change it.`, 403, { owner_id: owner });
}
