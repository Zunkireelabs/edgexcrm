import { google } from "googleapis";
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
