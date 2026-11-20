// Website chat set-up and settings for one tenant. An admin clicks "Connect" once; this creates
// the tenant's Chatwoot account, a shared team user, the website inbox and the webhook, then stores
// the credentials (encrypted) on an inbox_channels row. Later saves push the settings to Chatwoot.
//
// Source of truth for the settings is the channel row (meta.website_chat); Chatwoot is updated
// from it. Callers must already have checked: signed in, admin, INBOX_CHATWOOT_ENABLED.

import type { SupabaseClient } from "@supabase/supabase-js";
import { logger } from "@/lib/logger";
import { decryptToken, encryptToken } from "../crypto";
import { buildChatwootPassword } from "../chatwoot-agents";
import { chatwootBaseUrl, chatwootRequest, parseChatwootChannelRef } from "../chatwoot-api";
import { chatwootChannelRef } from "../adapters/chatwoot";
import {
  buildWidgetSnippet,
  DEFAULT_WEBSITE_CHAT_SETTINGS,
  toChatwootChannel,
  toChatwootInbox,
  withSettingDefaults,
  type WebsiteChatSettings,
} from "./settings";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = SupabaseClient<any>;

const UNIQUE_VIOLATION = "23505";

/** What is stored in inbox_channels.meta.website_chat. */
interface StoredWebsiteChat {
  settings: WebsiteChatSettings;
  enabled: boolean;
  websiteToken: string;
  /** The inbox logo's address on the Chatwoot server, once one is uploaded. */
  logoUrl?: string | null;
}

interface ChannelRow {
  id: string;
  external_account_id: string;
  access_token: string | null;
  meta: { webhook_secret_enc?: string; website_chat?: StoredWebsiteChat } | null;
}

export class WebsiteChatError extends Error {
  constructor(
    message: string,
    readonly code: "not_configured" | "already_connected" | "not_connected" | "chatwoot_failed"
  ) {
    super(message);
  }
}

export interface WebsiteChatState {
  connected: boolean;
  enabled: boolean;
  settings: WebsiteChatSettings | null;
  /** The code to paste on the website. Null until connected. */
  snippet: string | null;
  /** The logo shown at the top of the chat window, if one was uploaded. */
  logoUrl: string | null;
}

function requirePlatformToken(): string {
  const token = process.env.CHATWOOT_PLATFORM_TOKEN?.trim();
  if (!token) throw new WebsiteChatError("Website chat is not set up on this server (missing platform token)", "not_configured");
  return token;
}

function appBaseUrl(): string {
  const base = (process.env.NEXT_PUBLIC_APP_URL ?? "").trim().replace(/\/+$/, "");
  if (!/^https?:\/\//.test(base)) throw new WebsiteChatError("Website chat is not set up on this server (missing app address)", "not_configured");
  return base;
}

/**
 * Chatwoot shows "We are away" unless an agent is online. Counsellors answer from EdgeX, not from Chatwoot, so the
 * shared team user never is. Keep it online and stop Chatwoot logging it out when nothing is connected.
 * Best effort: a failure is logged, the settings are still saved, and the chat just keeps saying "away".
 */
async function keepTeamOnline(baseUrl: string, accountId: string | number, apiToken: string, tenantId: string): Promise<void> {
  try {
    await chatwootRequest("POST", `${baseUrl}/api/v1/profile/availability`, apiToken, {
      profile: { account_id: Number(accountId), availability: "online" },
    });
    await chatwootRequest("POST", `${baseUrl}/api/v1/profile/auto_offline`, apiToken, {
      profile: { account_id: Number(accountId), auto_offline: false },
    });
  } catch (err) {
    logger.error({ err: err instanceof Error ? err.message : String(err), tenantId }, "website chat: could not keep the team user online");
  }
}

async function findChannel(db: Db, tenantId: string): Promise<ChannelRow | null> {
  const { data } = await db
    .from("inbox_channels")
    .select("id, external_account_id, access_token, meta")
    .eq("tenant_id", tenantId)
    .eq("provider", "chatwoot")
    .maybeSingle();
  return (data as ChannelRow | null) ?? null;
}

export async function loadWebsiteChat(db: Db, tenantId: string): Promise<WebsiteChatState> {
  const channel = await findChannel(db, tenantId);
  const stored = channel?.meta?.website_chat;
  if (!channel || !stored) return { connected: false, enabled: false, settings: null, snippet: null, logoUrl: null };
  return {
    connected: true,
    enabled: stored.enabled,
    settings: withSettingDefaults(stored.settings),
    snippet: buildWidgetSnippet(chatwootBaseUrl(), stored.websiteToken),
    logoUrl: stored.logoUrl ?? null,
  };
}

export interface ConnectWebsiteChatInput {
  db: Db;
  tenantId: string;
  tenantName: string;
  userId: string;
  websiteHost: string;
}

/**
 * Creates everything in Chatwoot, then the channel row. The row is written last, so a failure
 * half-way leaves only unused Chatwoot objects (harmless) and the admin can simply click again.
 */
export async function connectWebsiteChat(input: ConnectWebsiteChatInput): Promise<WebsiteChatState> {
  const { db, tenantId, tenantName, userId, websiteHost } = input;
  const platformToken = requirePlatformToken();
  const baseUrl = chatwootBaseUrl();
  const webhookUrl = `${appBaseUrl()}/api/webhooks/chatwoot`;

  const existing = await findChannel(db, tenantId);
  if (existing) {
    // A chatwoot channel without the card's saved settings was set up by hand (a script or the API), not by this
    // card. The card cannot manage it, so say what to do instead of a bare "already connected".
    const message = existing.meta?.website_chat
      ? "Website chat is already connected"
      : "A Chatwoot channel was already set up by hand for this account. Remove it under Messaging Channels first, then connect again.";
    throw new WebsiteChatError(message, "already_connected");
  }

  const settings: WebsiteChatSettings = { ...DEFAULT_WEBSITE_CHAT_SETTINGS, title: `Chat with ${tenantName}`, websiteHost };

  try {
    // 1. The tenant's own Chatwoot account, so chats of different tenants never share a place.
    const account = await chatwootRequest<{ id: number }>("POST", `${baseUrl}/platform/api/v1/accounts`, platformToken, {
      name: tenantName,
    });

    // 2. One shared team user. Nobody logs in as it; it owns the API credential for the channel.
    //    The email is made up (".invalid" can never receive mail) and never shown to a visitor.
    const teamUser = await chatwootRequest<{ id: number; access_token: string }>("POST", `${baseUrl}/platform/api/v1/users`, platformToken, {
      name: `${tenantName} Team`,
      email: `website-chat+${tenantId}@chat.invalid`,
      password: buildChatwootPassword(),
      custom_attributes: {},
    });
    await chatwootRequest("POST", `${baseUrl}/platform/api/v1/accounts/${account.id}/account_users`, platformToken, {
      user_id: teamUser.id,
      role: "administrator",
    });

    // 3. The website inbox, created as the team user so it can read and reply.
    const inbox = await chatwootRequest<{ id: number; website_token: string }>(
      "POST",
      `${baseUrl}/api/v1/accounts/${account.id}/inboxes`,
      teamUser.access_token,
      { ...toChatwootInbox(settings), channel: { type: "web_widget", ...toChatwootChannel(settings, true) } }
    );
    await chatwootRequest("POST", `${baseUrl}/api/v1/accounts/${account.id}/inbox_members`, teamUser.access_token, {
      inbox_id: inbox.id,
      user_ids: [teamUser.id],
    });
    await keepTeamOnline(baseUrl, account.id, teamUser.access_token, tenantId);

    // 4. The webhook that sends visitor messages to EdgeX. Chatwoot makes the signing secret.
    const webhookResponse = await chatwootRequest<{ payload?: { webhook?: { secret?: string } }; webhook?: { secret?: string } }>(
      "POST",
      `${baseUrl}/api/v1/accounts/${account.id}/webhooks`,
      teamUser.access_token,
      { webhook: { url: webhookUrl, subscriptions: ["message_created"] } }
    );
    const secret = webhookResponse.payload?.webhook?.secret ?? webhookResponse.webhook?.secret;
    if (!secret) throw new Error("Chatwoot did not return a webhook secret");

    // 5. Only now remember it in EdgeX.
    const stored: StoredWebsiteChat = { settings, enabled: true, websiteToken: inbox.website_token };
    const { error } = await db.from("inbox_channels").insert({
      tenant_id: tenantId,
      provider: "chatwoot",
      external_account_id: chatwootChannelRef(account.id, inbox.id),
      display_name: "Website chat",
      status: "active",
      access_token: encryptToken(teamUser.access_token),
      connected_by_user_id: userId,
      meta: { webhook_secret_enc: encryptToken(secret), website_chat: stored },
    });
    if (error) {
      if (error.code === UNIQUE_VIOLATION) throw new WebsiteChatError("Website chat is already connected", "already_connected");
      throw new Error(`Could not save the channel: ${error.message}`);
    }

    return { connected: true, enabled: true, settings, snippet: buildWidgetSnippet(baseUrl, inbox.website_token), logoUrl: null };
  } catch (err) {
    if (err instanceof WebsiteChatError) throw err;
    logger.error({ err: err instanceof Error ? err.message : String(err), tenantId }, "website chat: connect failed");
    throw new WebsiteChatError("Could not set up website chat. Nothing was changed on your side; please try again.", "chatwoot_failed");
  }
}

export interface UpdateWebsiteChatInput {
  db: Db;
  tenantId: string;
  settings: WebsiteChatSettings;
  enabled: boolean;
}

/** Pushes the settings to Chatwoot first; EdgeX stores them only once Chatwoot accepted them. */
export async function updateWebsiteChat(input: UpdateWebsiteChatInput): Promise<WebsiteChatState> {
  const { db, tenantId, settings, enabled } = input;
  const channel = await findChannel(db, tenantId);
  const stored = channel?.meta?.website_chat;
  if (!channel || !stored || !channel.access_token) throw new WebsiteChatError("Website chat is not connected", "not_connected");

  const baseUrl = chatwootBaseUrl();
  const { accountId, inboxId } = parseChatwootChannelRef(channel.external_account_id);

  const apiToken = decryptToken(channel.access_token);
  try {
    await chatwootRequest("PATCH", `${baseUrl}/api/v1/accounts/${accountId}/inboxes/${inboxId}`, apiToken, {
      ...toChatwootInbox(settings),
      channel: toChatwootChannel(settings, enabled),
    });
  } catch (err) {
    logger.error({ err: err instanceof Error ? err.message : String(err), tenantId }, "website chat: update failed");
    throw new WebsiteChatError("Could not save your changes. Please try again.", "chatwoot_failed");
  }

  // Also heals tenants connected before this existed: the team user is made online on the next save.
  await keepTeamOnline(baseUrl, accountId, apiToken, tenantId);

  const next: StoredWebsiteChat = { ...stored, settings, enabled };
  const { error } = await db
    .from("inbox_channels")
    // On/off lives in meta.website_chat.enabled. The channel status is left alone: inbox_channels.status only
    // allows active / disconnected / error / pending (a "paused" value is rejected by the database), and
    // chats already open must keep working while the bubble is hidden.
    .update({ meta: { ...channel.meta, website_chat: next } })
    .eq("id", channel.id)
    .eq("tenant_id", tenantId);
  if (error) {
    logger.error({ err: error.message, tenantId }, "website chat: saved in Chatwoot but not in EdgeX");
    throw new WebsiteChatError("Could not save your changes. Please try again.", "chatwoot_failed");
  }

  return { connected: true, enabled, settings, snippet: buildWidgetSnippet(baseUrl, stored.websiteToken), logoUrl: stored.logoUrl ?? null };
}

export interface WebsiteChatLogoInput {
  db: Db;
  tenantId: string;
  /** Already checked by the caller: a PNG, JPEG or WebP of a safe size. */
  file: { bytes: Uint8Array; type: string; name: string };
}

/** Saves what happened to the logo on the channel row, after Chatwoot has accepted it. */
async function storeLogoUrl(db: Db, channel: ChannelRow, stored: StoredWebsiteChat, tenantId: string, logoUrl: string | null) {
  const { error } = await db
    .from("inbox_channels")
    .update({ meta: { ...channel.meta, website_chat: { ...stored, logoUrl } } })
    .eq("id", channel.id)
    .eq("tenant_id", tenantId);
  if (error) {
    logger.error({ err: error.message, tenantId }, "website chat: logo saved in Chatwoot but not in EdgeX");
    throw new WebsiteChatError("Could not save the logo. Please try again.", "chatwoot_failed");
  }
}

/** Sets the logo shown at the top of the chat window (the inbox avatar in Chatwoot). */
export async function uploadWebsiteChatLogo(input: WebsiteChatLogoInput): Promise<WebsiteChatState> {
  const { db, tenantId, file } = input;
  const channel = await findChannel(db, tenantId);
  const stored = channel?.meta?.website_chat;
  if (!channel || !stored || !channel.access_token) throw new WebsiteChatError("Website chat is not connected", "not_connected");

  const baseUrl = chatwootBaseUrl();
  const { accountId, inboxId } = parseChatwootChannelRef(channel.external_account_id);

  let logoUrl: string | null;
  try {
    const form = new FormData();
    form.append("avatar", new Blob([file.bytes as BlobPart], { type: file.type }), file.name);
    const inbox = await chatwootRequest<{ avatar_url?: string }>(
      "PATCH",
      `${baseUrl}/api/v1/accounts/${accountId}/inboxes/${inboxId}`,
      decryptToken(channel.access_token),
      form
    );
    logoUrl = inbox.avatar_url || null;
  } catch (err) {
    logger.error({ err: err instanceof Error ? err.message : String(err), tenantId }, "website chat: logo upload failed");
    throw new WebsiteChatError("Could not upload the logo. Please try again.", "chatwoot_failed");
  }

  await storeLogoUrl(db, channel, stored, tenantId, logoUrl);
  return { connected: true, enabled: stored.enabled, settings: withSettingDefaults(stored.settings), snippet: buildWidgetSnippet(baseUrl, stored.websiteToken), logoUrl };
}

/** Removes the logo again. */
export async function removeWebsiteChatLogo(input: Omit<WebsiteChatLogoInput, "file">): Promise<WebsiteChatState> {
  const { db, tenantId } = input;
  const channel = await findChannel(db, tenantId);
  const stored = channel?.meta?.website_chat;
  if (!channel || !stored || !channel.access_token) throw new WebsiteChatError("Website chat is not connected", "not_connected");

  const baseUrl = chatwootBaseUrl();
  const { accountId, inboxId } = parseChatwootChannelRef(channel.external_account_id);
  try {
    await chatwootRequest("DELETE", `${baseUrl}/api/v1/accounts/${accountId}/inboxes/${inboxId}/avatar`, decryptToken(channel.access_token));
  } catch (err) {
    logger.error({ err: err instanceof Error ? err.message : String(err), tenantId }, "website chat: logo removal failed");
    throw new WebsiteChatError("Could not remove the logo. Please try again.", "chatwoot_failed");
  }

  await storeLogoUrl(db, channel, stored, tenantId, null);
  return { connected: true, enabled: stored.enabled, settings: withSettingDefaults(stored.settings), snippet: buildWidgetSnippet(baseUrl, stored.websiteToken), logoUrl: null };
}
