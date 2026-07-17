import { authenticateRequest } from "@/lib/api/auth";
import { apiUnauthorized, apiForbidden, apiSuccess, apiServiceUnavailable } from "@/lib/api/response";
import { getFeatureAccess } from "@/industries/_loader";
import { FEATURES } from "@/industries/_registry";
import { createHmac } from "crypto";

const GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";

function getRedirectUri() {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3001";
  return `${appUrl}/api/v1/email/inboxes/callback`;
}

function signState(userId: string): string {
  const secret = process.env.NEXTAUTH_SECRET || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
  const sig = createHmac("sha256", secret).update(userId).digest("hex").slice(0, 16);
  return `${userId}.${sig}`;
}

export async function POST() {
  const auth = await authenticateRequest();
  if (!auth) return apiUnauthorized();
  if (!getFeatureAccess(auth.industryId, FEATURES.EMAIL)) return apiForbidden();

  const clientId = process.env.GOOGLE_CLIENT_ID;
  if (!clientId) {
    return apiServiceUnavailable("Google OAuth not configured. Set GOOGLE_CLIENT_ID in environment.");
  }

  const state = signState(auth.userId);

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: getRedirectUri(),
    response_type: "code",
    // Sensitive-tier scopes (not the restricted `mail.google.com` full-mailbox
    // scope) — readonly covers history/message reads for reply-sync, send
    // covers outbound. Keeps CASA Tier 2 security assessment out of the
    // verification path entirely; only standard OAuth review is needed.
    scope:
      "https://www.googleapis.com/auth/gmail.readonly https://www.googleapis.com/auth/gmail.send https://www.googleapis.com/auth/userinfo.email",
    access_type: "offline",
    prompt: "consent",
    state,
  });

  return apiSuccess({ url: `${GOOGLE_AUTH_URL}?${params.toString()}` });
}
