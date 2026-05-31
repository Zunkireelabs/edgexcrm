import { google } from "googleapis";
import MailComposer from "nodemailer/lib/mail-composer";
import { randomUUID } from "crypto";
import type { ConnectedEmailAccount } from "@/types/database";

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
    // threadId / inReplyTo / references intentionally omitted — Phase 3 adds reply support
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
    requestBody: { raw: encoded },
  });

  return {
    gmail_message_id: result.data.id!,
    gmail_thread_id: result.data.threadId!,
    rfc_message_id: rfcMessageId,
    refreshed_credentials: refreshed,
  };
}
