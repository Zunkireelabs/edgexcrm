// Per-counselor identity for website-chat replies.
//
// The visitor's bubble shows the name of whoever SENT a reply in Chatwoot, and Chatwoot takes
// that from the API credential used. With one shared credential every counselor looked like the
// same person. This gives each EdgeX counselor their own Chatwoot user (created the first time
// they reply) and sends their replies with that user's credential, so the visitor sees their name.
//
// Only the NAME is used. No photo is set (Chatwoot shows initials) and the counselor's email is
// stored in Chatwoot only to identify the user; it is never shown to a visitor. When anything is
// missing or fails (no platform token, no name on the profile, Chatwoot error), callers fall back
// to the channel's shared team identity, so a reply is never blocked by this.
//
// Verified against Chatwoot 4.19.1:
//  - a counselor-level user cannot reply until it is a member of the inbox (HTTP 401 otherwise);
//  - POST /inbox_members only ADDS members; POST /platform/.../account_users is idempotent but
//    would overwrite an existing user's ROLE, so it is skipped for people already in the account.

import { randomBytes } from "crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { logger } from "@/lib/logger";
import { decryptToken, encryptToken } from "./crypto";
import { chatwootBaseUrl, chatwootRequest, parseChatwootChannelRef } from "./chatwoot-api";
import type { InboxChannel } from "./adapters/types";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = SupabaseClient<any>;

const MAX_NAME_LENGTH = 100;
const UNIQUE_VIOLATION = "23505";

/**
 * A throwaway password for the Chatwoot user (nobody ever logs in with it). Chatwoot refuses a
 * password without an uppercase letter, a lowercase letter, a number AND a symbol, and random
 * base64 text often has no symbol, so the fixed tail guarantees all four every time.
 */
export function buildChatwootPassword(random: string = randomBytes(24).toString("base64url")): string {
  return `${random}aA1!`;
}

export interface ResolveChatwootAgentTokenInput {
  db: Db;
  /** The channel, with access_token already decrypted (it is the team admin's Chatwoot token). */
  channel: InboxChannel;
  /** The EdgeX user who is replying. */
  userId: string;
}

interface Person {
  name: string;
  email: string;
}

/** Name and email from the auth profile; null when the person has no usable name or email. */
async function loadPerson(db: Db, userId: string): Promise<Person | null> {
  const { data } = await db.auth.admin.getUserById(userId);
  const user = data?.user;
  if (!user?.email) return null;

  // Same source EdgeX's own team list uses for a person's name.
  const meta = (user.user_metadata ?? {}) as Record<string, unknown>;
  const rawName = typeof meta.name === "string" ? meta.name : typeof meta.full_name === "string" ? meta.full_name : "";
  const name = rawName.trim().slice(0, MAX_NAME_LENGTH);
  if (!name) return null; // never show an email address to a visitor: use the team identity instead

  return { name, email: user.email };
}

/**
 * The Chatwoot API credential of the counselor who is replying, creating their Chatwoot user,
 * account membership and inbox membership on first use. Null means "use the team identity".
 * May throw on a Chatwoot failure; the caller falls back to the team identity.
 */
export async function resolveChatwootAgentToken({ db, channel, userId }: ResolveChatwootAgentTokenInput): Promise<string | null> {
  const platformToken = process.env.CHATWOOT_PLATFORM_TOKEN?.trim();
  if (!platformToken || !channel.access_token) return null;

  const { data: existing } = await db
    .from("chatwoot_agent_links")
    .select("access_token")
    .eq("tenant_id", channel.tenant_id)
    .eq("channel_id", channel.id)
    .eq("user_id", userId)
    .maybeSingle();
  const stored = (existing as { access_token?: string } | null)?.access_token;
  if (stored) return decryptToken(stored);

  const person = await loadPerson(db, userId);
  if (!person) {
    logger.info({ userId, channelId: channel.id }, "chatwoot agent: no profile name, replying as the team identity");
    return null;
  }

  const baseUrl = chatwootBaseUrl();
  const { accountId, inboxId } = parseChatwootChannelRef(channel.external_account_id);

  // 1. The Chatwoot user. Chatwoot returns the existing one when the email is already known.
  const created = await chatwootRequest<{ id: number; access_token: string }>("POST", `${baseUrl}/platform/api/v1/users`, platformToken, {
    name: person.name,
    email: person.email,
    password: buildChatwootPassword(), // never used: nobody logs in with it
    custom_attributes: {},
  });
  if (!created.id || !created.access_token) throw new Error("Chatwoot did not return a user id and token");

  // 2. Member of the account as a plain agent, unless already in it (keeps an existing higher role).
  const accountUsers = await chatwootRequest<Array<{ user_id: number }>>(
    "GET",
    `${baseUrl}/platform/api/v1/accounts/${accountId}/account_users`,
    platformToken
  );
  if (!accountUsers.some((member) => member.user_id === created.id)) {
    await chatwootRequest("POST", `${baseUrl}/platform/api/v1/accounts/${accountId}/account_users`, platformToken, {
      user_id: created.id,
      role: "agent",
    });
  }

  // 3. Member of this inbox, otherwise Chatwoot refuses their replies (401). Adds only.
  await chatwootRequest("POST", `${baseUrl}/api/v1/accounts/${accountId}/inbox_members`, channel.access_token, {
    inbox_id: Number(inboxId),
    user_ids: [created.id],
  });

  // 4. Remember the credential (encrypted) so this runs once per counselor per channel.
  const { error } = await db.from("chatwoot_agent_links").insert({
    tenant_id: channel.tenant_id,
    channel_id: channel.id,
    user_id: userId,
    chatwoot_user_id: created.id,
    access_token: encryptToken(created.access_token),
  });
  if (error) {
    if (error.code !== UNIQUE_VIOLATION) throw new Error(`Could not store the Chatwoot agent link: ${error.message}`);
    // Two first replies at once: the other one stored it first. Use theirs.
    const { data: winner } = await db
      .from("chatwoot_agent_links")
      .select("access_token")
      .eq("tenant_id", channel.tenant_id)
      .eq("channel_id", channel.id)
      .eq("user_id", userId)
      .maybeSingle();
    const winnerToken = (winner as { access_token?: string } | null)?.access_token;
    if (winnerToken) return decryptToken(winnerToken);
  }

  return created.access_token;
}
