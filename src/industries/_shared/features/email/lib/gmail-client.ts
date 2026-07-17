import { google } from "googleapis";
import MailComposer from "nodemailer/lib/mail-composer";
import { randomUUID } from "crypto";
import type { ConnectedEmailAccount } from "@/types/database";
import { parseGmailMessage, type ParsedMessage } from "./gmail-parser";

export type { ParsedMessage };

const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID!;
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET!;

export function createOAuth2Client(refreshToken: string) {
  const oauth2Client = new google.auth.OAuth2(
    GOOGLE_CLIENT_ID,
    GOOGLE_CLIENT_SECRET,
  );
  oauth2Client.setCredentials({ refresh_token: refreshToken });
  return oauth2Client;
}

export async function getProfileEmail(
  client: ReturnType<typeof createOAuth2Client>,
): Promise<string> {
  const gmail = google.gmail({ version: "v1", auth: client });
  const profile = await gmail.users.getProfile({ userId: "me" });
  const email = profile.data.emailAddress;
  if (!email) throw new Error("No email address in Gmail profile");
  return email;
}

/**
 * Revoke a Gmail OAuth grant on Google's side (undoes "prompt=consent").
 * Call this on Disconnect — without it, deleting the local row only forgets
 * the credential here; the grant stays live under the user's Google Account
 * (Security → Third-party access) with a refresh_token nobody references
 * anymore but that was never actually invalidated.
 * Returns false (never throws) on any failure — the caller should still
 * remove the local row; a revoke failure just means the Google-side grant
 * lingers, which is a hygiene gap, not a reason to block disconnecting.
 */
export async function revokeToken(token: string): Promise<boolean> {
  try {
    const res = await fetch(
      `https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(token)}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        signal: AbortSignal.timeout(8000),
      },
    );
    return res.ok;
  } catch {
    return false;
  }
}

export async function refreshAccessTokenIfNeeded(
  account: ConnectedEmailAccount,
): Promise<{ access_token: string; expiry_date: number } | null> {
  const bufferMs = 5 * 60 * 1000; // refresh 5 minutes before expiry
  const expiry = account.token_expiry ? new Date(account.token_expiry).getTime() : 0;
  if (account.access_token && expiry > Date.now() + bufferMs) {
    return null;
  }
  const client = createOAuth2Client(account.refresh_token);
  const { credentials } = await client.refreshAccessToken();
  return {
    access_token: credentials.access_token ?? "",
    expiry_date: credentials.expiry_date ?? 0,
  };
}

// Phase 3: poll Gmail History API for new messages since startHistoryId
export async function listHistory(
  account: ConnectedEmailAccount,
  startHistoryId: string,
): Promise<{
  historyId: string;
  messageAddedIds: string[];
  refreshed_credentials: { access_token: string; expiry_date: number } | null;
  expired?: true;
}> {
  const refreshed = await refreshAccessTokenIfNeeded(account);
  const client = createOAuth2Client(account.refresh_token);
  if (refreshed) {
    client.setCredentials({
      refresh_token: account.refresh_token,
      access_token: refreshed.access_token,
      expiry_date: refreshed.expiry_date,
    });
  }
  const gmail = google.gmail({ version: "v1", auth: client });
  try {
    const res = await gmail.users.history.list({
      userId: "me",
      startHistoryId,
      historyTypes: ["messageAdded"],
      maxResults: 100,
    });
    const messageAddedIds: string[] = [];
    for (const entry of res.data.history ?? []) {
      for (const msgAdded of entry.messagesAdded ?? []) {
        if (msgAdded.message?.id) messageAddedIds.push(msgAdded.message.id);
      }
    }
    return {
      historyId: res.data.historyId ?? startHistoryId,
      messageAddedIds: Array.from(new Set(messageAddedIds)),
      refreshed_credentials: refreshed,
    };
  } catch (err) {
    // 404 = historyId too old (Gmail retains ~7 days of history)
    const status = (err as { code?: number }).code;
    if (status === 404) {
      return { historyId: "", messageAddedIds: [], refreshed_credentials: refreshed, expired: true };
    }
    throw err;
  }
}

// Phase 3: fetch a single Gmail message and parse it
export async function getMessage(
  account: ConnectedEmailAccount,
  messageId: string,
): Promise<{
  message: ParsedMessage;
  refreshed_credentials: { access_token: string; expiry_date: number } | null;
}> {
  const refreshed = await refreshAccessTokenIfNeeded(account);
  const client = createOAuth2Client(account.refresh_token);
  if (refreshed) {
    client.setCredentials({
      refresh_token: account.refresh_token,
      access_token: refreshed.access_token,
      expiry_date: refreshed.expiry_date,
    });
  }
  const gmail = google.gmail({ version: "v1", auth: client });
  const res = await gmail.users.messages.get({
    userId: "me",
    id: messageId,
    format: "full",
  });
  return { message: parseGmailMessage(res.data), refreshed_credentials: refreshed };
}

function htmlToText(html: string): string {
  return html.replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
}

export async function sendMessage(
  account: ConnectedEmailAccount,
  args: {
    from: string;
    fromName?: string;
    to: string[];
    cc?: string[];
    bcc?: string[];
    subject: string;
    bodyHtml: string;
    bodyText?: string;
    threadId?: string;    // Phase 3: threads the sent message in Gmail
    inReplyTo?: string;  // Phase 3: sets In-Reply-To header
    references?: string[]; // Phase 3: sets References header
  },
): Promise<{
  gmail_message_id: string;
  gmail_thread_id: string;
  rfc_message_id: string;
  refreshed_credentials: { access_token: string; expiry_date: number } | null;
}> {
  const rfcMessageId = `<${randomUUID()}@edgex-crm.com>`;

  // Refresh token before sending so the access_token we use is fresh
  const refreshed = await refreshAccessTokenIfNeeded(account);

  const mail = new MailComposer({
    from: args.fromName ? `"${args.fromName}" <${args.from}>` : args.from,
    to: args.to.join(", "),
    cc: args.cc?.join(", "),
    bcc: args.bcc?.join(", "),
    subject: args.subject,
    html: args.bodyHtml,
    text: args.bodyText ?? htmlToText(args.bodyHtml),
    messageId: rfcMessageId,
    // Phase 3: RFC threading headers
    inReplyTo: args.inReplyTo,
    references: args.references?.join(" "),
  });

  const raw = await mail.compile().build();

  const encoded = raw
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");

  const client = createOAuth2Client(account.refresh_token);
  if (refreshed) {
    // Use the freshly-obtained access token to avoid a second refresh roundtrip
    client.setCredentials({
      refresh_token: account.refresh_token,
      access_token: refreshed.access_token,
      expiry_date: refreshed.expiry_date,
    });
  }
  const gmail = google.gmail({ version: "v1", auth: client });

  const result = await gmail.users.messages.send({
    userId: "me",
    requestBody: {
      raw: encoded,
      // Phase 3: threadId groups the reply into the existing Gmail thread
      ...(args.threadId && { threadId: args.threadId }),
    },
  });

  return {
    gmail_message_id: result.data.id!,
    gmail_thread_id: result.data.threadId!,
    rfc_message_id: rfcMessageId,
    refreshed_credentials: refreshed,
  };
}
