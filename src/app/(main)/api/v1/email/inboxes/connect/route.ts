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

export async function POST(request: Request) {
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
    // Path A (send-only): request ONLY gmail.send (Sensitive) + userinfo.email.
    // gmail.readonly is a RESTRICTED scope that would force an annual CASA
    // security assessment — deferred to Path B when inbound reply-sync + AI
    // reply-monitoring are built. See docs/email-productionization/.
    scope:
      "https://www.googleapis.com/auth/gmail.send https://www.googleapis.com/auth/userinfo.email",
    access_type: "offline",
    prompt: "consent",
    state,
  });

  // Reconnecting a specific broken inbox: bias Google's account chooser
  // toward that address so the user doesn't accidentally authorize a
  // different Google account and end up with a brand-new inbox row while
  // the one they meant to fix stays broken. A hint only, not enforced —
  // Google still lets the user pick a different account if they want to.
  let body: unknown = null;
  try {
    body = await request.json();
  } catch {
    // No body (or invalid JSON) is fine — this is a plain "connect a new inbox".
  }
  const loginHint =
    body && typeof body === "object" && "login_hint" in body && typeof (body as { login_hint: unknown }).login_hint === "string"
      ? (body as { login_hint: string }).login_hint
      : null;
  if (loginHint) {
    params.set("login_hint", loginHint);
  }

  return apiSuccess({ url: `${GOOGLE_AUTH_URL}?${params.toString()}` });
}
