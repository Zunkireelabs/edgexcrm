import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { createRequestLogger } from "@/lib/logger";

const GOOGLE_CLIENT_ID = process.env.GOOGLE_CLIENT_ID;
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CLIENT_SECRET;
const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const GOOGLE_USERINFO_URL = "https://www.googleapis.com/oauth2/v2/userinfo";

function getRedirectUri() {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3001";
  return `${appUrl}/api/v1/settings/email-accounts/gmail/callback`;
}

function getSettingsUrl(params?: string) {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3001";
  return `${appUrl}/settings${params ? `?${params}` : ""}`;
}

// GET /api/v1/settings/email-accounts/gmail/callback — handle Google OAuth callback
export async function GET(request: NextRequest) {
  const log = createRequestLogger({
    requestId: crypto.randomUUID(),
    method: "GET",
    path: "/api/v1/settings/email-accounts/gmail/callback",
  });

  const code = request.nextUrl.searchParams.get("code");
  const stateParam = request.nextUrl.searchParams.get("state");
  const error = request.nextUrl.searchParams.get("error");

  if (error) {
    log.error({ error }, "Google OAuth error");
    return NextResponse.redirect(getSettingsUrl("gmail=error&reason=denied"));
  }

  if (!code || !stateParam) {
    return NextResponse.redirect(getSettingsUrl("gmail=error&reason=missing_code"));
  }

  if (!GOOGLE_CLIENT_ID || !GOOGLE_CLIENT_SECRET) {
    log.error("Google OAuth credentials not configured");
    return NextResponse.redirect(getSettingsUrl("gmail=error&reason=not_configured"));
  }

  // Decode state to get tenant_id
  let tenantId: string;
  try {
    const state = JSON.parse(Buffer.from(stateParam, "base64url").toString());
    tenantId = state.tenantId;
    if (!tenantId) throw new Error("No tenantId in state");
  } catch {
    log.error("Invalid state param");
    return NextResponse.redirect(getSettingsUrl("gmail=error&reason=invalid_state"));
  }

  try {
    // Exchange code for tokens
    const tokenRes = await fetch(GOOGLE_TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: GOOGLE_CLIENT_ID,
        client_secret: GOOGLE_CLIENT_SECRET,
        redirect_uri: getRedirectUri(),
        grant_type: "authorization_code",
      }),
    });

    const tokenData = await tokenRes.json();

    if (!tokenRes.ok || !tokenData.refresh_token) {
      log.error({ tokenData }, "Failed to exchange code for tokens");
      return NextResponse.redirect(getSettingsUrl("gmail=error&reason=token_exchange"));
    }

    // Fetch user email
    const userRes = await fetch(GOOGLE_USERINFO_URL, {
      headers: { Authorization: `Bearer ${tokenData.access_token}` },
    });

    const userData = await userRes.json();
    const email = userData.email as string;

    if (!email) {
      log.error("Failed to get user email from Google");
      return NextResponse.redirect(getSettingsUrl("gmail=error&reason=no_email"));
    }

    const supabase = await createServiceClient();

    // Check if this email is already connected for this tenant
    const { data: existing } = await supabase
      .from("connected_email_accounts")
      .select("id")
      .eq("tenant_id", tenantId)
      .eq("email", email)
      .single();

    if (existing) {
      // Update existing account with new tokens
      await supabase
        .from("connected_email_accounts")
        .update({
          refresh_token: tokenData.refresh_token,
          access_token: tokenData.access_token,
          token_expiry: new Date(Date.now() + tokenData.expires_in * 1000).toISOString(),
        })
        .eq("id", existing.id);

      log.info({ email, tenantId }, "Updated existing Gmail connection");
    } else {
      // Create new connected account
      await supabase.from("connected_email_accounts").insert({
        tenant_id: tenantId,
        provider: "gmail",
        email,
        refresh_token: tokenData.refresh_token,
        access_token: tokenData.access_token,
        token_expiry: new Date(Date.now() + tokenData.expires_in * 1000).toISOString(),
      });

      log.info({ email, tenantId }, "Gmail account connected");
    }

    return NextResponse.redirect(getSettingsUrl("gmail=connected"));
  } catch (err) {
    log.error({ err }, "Gmail OAuth callback failed");
    return NextResponse.redirect(getSettingsUrl("gmail=error&reason=unknown"));
  }
}
