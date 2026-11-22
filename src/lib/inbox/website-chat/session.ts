// The branded chat widget's front door. A visitor's browser asks here before it talks to Chatwoot. If the request comes from
// the tenant's own website and is not flooding, we hand back a fresh random visitor id plus its signature: HMAC-SHA256 of that
// id with the inbox's secret. The Chatwoot inbox has hmac_mandatory on, so it refuses every call that lacks a valid signature,
// and only this code can make one. The secret never leaves the server.
//
// Honest limit: the Origin header stops OTHER WEBSITES in a browser, but a script can send any Origin it likes. The rate limits
// are what blunt a scripted flood. A request with no Origin at all (curl, most scripts) is refused.
//
// Public endpoint, no login. It reads one inbox_channels row by its public identifier and returns nothing tenant-specific.

import { createHmac, randomUUID } from "crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { logger } from "@/lib/logger";
import { checkRateLimit, CHAT_SESSION_INBOX_LIMIT, CHAT_SESSION_IP_LIMIT } from "@/lib/api/rate-limit";
import { decryptToken } from "../crypto";
import { chatwootBaseUrl } from "../chatwoot-api";
import { allowedOriginsFor } from "./settings";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Db = SupabaseClient<any>;

/** Chatwoot's inbox identifiers are 24 character tokens; accept a sane range and nothing with symbols. */
const INBOX_IDENTIFIER = /^[A-Za-z0-9]{16,64}$/;

export interface ChatSession {
  chatwootBaseUrl: string;
  inboxIdentifier: string;
  /** A fresh random visitor id. */
  identifier: string;
  /** HMAC-SHA256(secret, identifier) as hex. Sent with every Chatwoot call for this visitor. */
  identifierHash: string;
}

export type ChatSessionResult =
  | { ok: true; origin: string; session: ChatSession }
  | { ok: false; status: 400 | 403 | 404 | 429 | 503; code: string; message: string; retryAfterSeconds?: number };

interface ChannelRow {
  meta: {
    website_chat?: {
      enabled?: boolean;
      inboxType?: string;
      inboxIdentifier?: string;
      hmacTokenEnc?: string;
      settings?: { websiteHost?: string };
    };
  } | null;
}

const NOT_FOUND: ChatSessionResult = { ok: false, status: 404, code: "NOT_FOUND", message: "Chat is not available" };

export async function createChatSession(input: {
  db: Db;
  inboxIdentifier: unknown;
  origin: string | null;
  ip: string;
}): Promise<ChatSessionResult> {
  const { db, ip } = input;
  if (process.env.INBOX_CHATWOOT_ENABLED !== "true") return NOT_FOUND;

  if (typeof input.inboxIdentifier !== "string" || !INBOX_IDENTIFIER.test(input.inboxIdentifier)) {
    return { ok: false, status: 400, code: "VALIDATION_ERROR", message: "Invalid chat id" };
  }
  const inboxIdentifier = input.inboxIdentifier;

  // The cheapest gate first: one address cannot hammer the lookup below.
  const ipLimit = await checkRateLimit(`chat_session_ip:${ip}`, CHAT_SESSION_IP_LIMIT);
  if (!ipLimit.allowed) return tooMany(ipLimit.retryAfterSeconds);

  const { data, error } = await db
    .from("inbox_channels")
    .select("meta")
    .eq("provider", "chatwoot")
    .eq("status", "active")
    .eq("meta->website_chat->>inboxIdentifier", inboxIdentifier)
    .maybeSingle();
  if (error) {
    logger.error({ err: error.message }, "chat session: could not look up the inbox");
    return { ok: false, status: 503, code: "UNAVAILABLE", message: "Chat is temporarily unavailable" };
  }

  // Unknown, switched off and wrong kind all look the same from outside, so ids cannot be probed.
  const chat = (data as ChannelRow | null)?.meta?.website_chat;
  if (!chat || chat.inboxType !== "api" || chat.enabled !== true || !chat.hmacTokenEnc || !chat.settings?.websiteHost) return NOT_FOUND;

  const origin = (input.origin ?? "").trim().toLowerCase();
  if (!origin) return { ok: false, status: 403, code: "FORBIDDEN", message: "This request must come from a website" };
  if (!allowedOriginsFor(chat.settings.websiteHost).includes(origin)) {
    return { ok: false, status: 403, code: "FORBIDDEN", message: "This website is not allowed to use this chat" };
  }

  const inboxLimit = await checkRateLimit(`chat_session_inbox:${inboxIdentifier}`, CHAT_SESSION_INBOX_LIMIT);
  if (!inboxLimit.allowed) return tooMany(inboxLimit.retryAfterSeconds);

  let secret: string;
  try {
    secret = decryptToken(chat.hmacTokenEnc);
  } catch (err) {
    logger.error({ err: err instanceof Error ? err.message : String(err) }, "chat session: could not read the inbox secret");
    return { ok: false, status: 503, code: "UNAVAILABLE", message: "Chat is temporarily unavailable" };
  }

  const identifier = randomUUID();
  const identifierHash = createHmac("sha256", secret).update(identifier).digest("hex");
  return { ok: true, origin, session: { chatwootBaseUrl: chatwootBaseUrl(), inboxIdentifier, identifier, identifierHash } };
}

function tooMany(retryAfterSeconds: number): ChatSessionResult {
  return { ok: false, status: 429, code: "RATE_LIMITED", message: "Too many requests, please try again shortly", retryAfterSeconds };
}
