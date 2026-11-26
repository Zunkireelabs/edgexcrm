// AI replies in the website chat: the settings an admin can change, the fixed values, and the on/off checks.
// Pure functions (no network, no database). Stored on the channel row at inbox_channels.meta.website_chat_ai, a
// separate key from the widget settings (meta.website_chat) so the two never touch each other.

/** How long a chat must be quiet before the AI answers, so a burst such as "Study in the UK" / "Ok" / "Fast" gets ONE answer. */
export const AI_REPLY_DEBOUNCE_MS = 3_000;

/** The only industry that gets AI replies (the Admizz website chat). */
export const AI_REPLY_INDUSTRY = "education_consultancy";

/** zunkiree-search rejects a question longer than this. */
export const MAX_QUESTION_CHARS = 500;

/**
 * How long to wait for the Admizz AI before giving up and leaving the chat for a person (the visitor then gets the holding
 * message). Quiet period + this = the longest a visitor waits for SOME reply: keep the two together under 10 seconds.
 */
export const SEARCH_TIMEOUT_MS = 6_000;

/** What the visitor is told when the AI hands the chat to the team. One constant so the team can change the wording later. */
export const HANDOFF_MESSAGE = "Thanks, I've passed your question to our counsellors. One of them will reply here soon.";

/**
 * What a visitor to the Admizz website chat is told while AI replies are OFF, so they are not left in silence. Sent once per
 * chat (see holding.ts). One constant so the team can change the wording later.
 */
export const HOLDING_MESSAGE =
  "Your chat has been transferred to live support, and an Admizz associate will connect with you as soon as possible. " +
  "We're currently experiencing high volume, so please keep this chat window open in the background while you wait. " +
  "If we aren't able to connect shortly, we'll follow up by Phone Call, Whatsapp or email. Thanks for your patience!";

/** Where the once-per-chat marker lives: conversations.meta.holding_sent_at (no new column). */
export const HOLDING_META_KEY = "holding_sent_at";

export type NeedsHumanReason = "out_of_knowledge" | "asked_for_person";

/** What is stored on the conversation (conversations.meta.needs_human) when the AI hands over. */
export interface NeedsHuman {
  at: string;
  reason: NeedsHumanReason;
}

export interface AiReplyConfig {
  enabled: boolean;
  /** The zunkiree-search site id of this tenant's education chatbot. */
  siteId: string;
}

export const DEFAULT_AI_REPLY_CONFIG: AiReplyConfig = { enabled: false, siteId: "" };

const SITE_ID_PATTERN = /^[A-Za-z0-9._-]{1,100}$/;

/** What an inbox channel's meta says about AI replies; anything missing or odd means "off". */
export function readAiReplyConfig(meta: unknown): AiReplyConfig {
  const raw = (meta as { website_chat_ai?: { enabled?: unknown; siteId?: unknown } } | null | undefined)?.website_chat_ai;
  const siteId = typeof raw?.siteId === "string" ? raw.siteId.trim() : "";
  return { enabled: raw?.enabled === true && SITE_ID_PATTERN.test(siteId), siteId: SITE_ID_PATTERN.test(siteId) ? siteId : "" };
}

export type ParsedAiReplyInput =
  | { ok: true; value: AiReplyConfig }
  | { ok: false; errors: Record<string, string[]> };

/** Validate what the settings screen sends. Turning AI on needs a site id. */
export function parseAiReplyInput(body: unknown): ParsedAiReplyInput {
  if (!body || typeof body !== "object" || Array.isArray(body)) return { ok: false, errors: { body: ["Request body must be a JSON object"] } };
  const { enabled, siteId } = body as { enabled?: unknown; siteId?: unknown };
  const errors: Record<string, string[]> = {};
  if (typeof enabled !== "boolean") errors.enabled = ["Must be true or false"];
  const id = typeof siteId === "string" ? siteId.trim() : "";
  if (siteId !== undefined && typeof siteId !== "string") errors.siteId = ["Must be text"];
  else if (id && !SITE_ID_PATTERN.test(id)) errors.siteId = ["Use letters, numbers, dots, dashes or underscores only"];
  else if (enabled === true && !id) errors.siteId = ["Enter the Admizz AI site ID to turn AI replies on"];
  if (Object.keys(errors).length) return { ok: false, errors };
  return { ok: true, value: { enabled: enabled as boolean, siteId: id } };
}

/** The server settings AI replies need. All three, or the feature is off. */
export function aiReplyEnv(env: Record<string, string | undefined> = process.env): { url: string; key: string } | null {
  if (env.INBOX_AI_REPLY_ENABLED !== "true") return null;
  const url = env.ZUNKIREE_SEARCH_URL?.trim().replace(/\/+$/, "");
  const key = env.ZUNKIREE_SEARCH_KEY?.trim();
  return url && key ? { url, key } : null;
}

/** Is the feature switched on for the whole server (used by the settings screen to show or hide the switch)? */
export function aiReplyServerEnabled(env: Record<string, string | undefined> = process.env): boolean {
  return aiReplyEnv(env) !== null;
}

/** The needs-human flag stored on a conversation's meta, or null. */
export function readNeedsHuman(meta: unknown): NeedsHuman | null {
  const raw = (meta as { needs_human?: { at?: unknown; reason?: unknown } } | null | undefined)?.needs_human;
  if (!raw || typeof raw.at !== "string") return null;
  return { at: raw.at, reason: raw.reason === "asked_for_person" ? "asked_for_person" : "out_of_knowledge" };
}
