import { NextRequest, NextResponse } from "next/server";
import { authenticateRequest } from "@/lib/api/auth";
import { apiUnauthorized, apiServiceUnavailable } from "@/lib/api/response";

const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";

function getRedirectUri() {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3001";
  return `${appUrl}/api/v1/settings/email-accounts/gmail/callback`;
}

// GET /api/v1/settings/email-accounts/gmail/auth — redirect to Google OAuth
export async function GET(request: NextRequest) {
  const auth = await authenticateRequest();
  if (!auth) return apiUnauthorized();

  if (!GOOGLE_CLIENT_ID) {
    return apiServiceUnavailable("Google OAuth not configured. Set GOOGLE_CLIENT_ID in environment.");
  }

  // Encode tenant_id in state param to associate the callback with the right tenant
  const state = Buffer.from(JSON.stringify({ tenantId: auth.tenantId })).toString("base64url");

  const params = new URLSearchParams({
    client_id: GOOGLE_CLIENT_ID,
    redirect_uri: getRedirectUri(),
    response_type: "code",
    scope: "https://mail.google.com/ https://www.googleapis.com/auth/userinfo.email",
    access_type: "offline",
    prompt: "consent",
    state,
  });

  return NextResponse.redirect(`${GOOGLE_AUTH_URL}?${params.toString()}`);
}
