import { NextRequest, NextResponse } from "next/server";
import { authenticateRequest } from "@/lib/api/auth";
import { getFeatureAccess } from "@/industries/_loader";
import { FEATURES } from "@/industries/_registry";
import { createServiceClient } from "@/lib/supabase/server";
import { createRequestLogger } from "@/lib/logger";
import { createHmac } from "crypto";
import { getProfileEmail, createOAuth2Client } from "@/industries/_shared/features/email/lib/gmail-client";

const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";

function getRedirectUri() {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3001";
  return `${appUrl}/api/v1/email/inboxes/callback`;
}

function getSettingsUrl(params?: string) {
  const appUrl = process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3001";
  return `${appUrl}/settings${params ? `?${params}` : ""}#connected-inboxes`;
}

function verifyState(state: string, userId: string): boolean {
  const parts = state.split(".");
  if (parts.length !== 2) return false;
  const [embeddedUserId, sig] = parts;
  if (embeddedUserId !== userId) return false;
  const secret = process.env.NEXTAUTH_SECRET || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!;
  const expected = createHmac("sha256", secret).update(userId).digest("hex").slice(0, 16);
  return sig === expected;
}

export async function GET(request: NextRequest) {
  const log = createRequestLogger({
    requestId: crypto.randomUUID(),
    method: "GET",
    path: "/api/v1/email/inboxes/callback",
  });

  // Industry gate runs BEFORE code exchange — even as an OAuth landing page,
  // non-education tenants must not consume this callback.
  const auth = await authenticateRequest();
  if (!auth) {
    log.error("No authenticated session in inbox OAuth callback");
    return NextResponse.redirect(getSettingsUrl("error=unauthenticated"));
  }
  if (!getFeatureAccess(auth.industryId, FEATURES.EMAIL)) {
    return NextResponse.redirect(getSettingsUrl("error=forbidden"));
  }

  const code = request.nextUrl.searchParams.get("code");
  const stateParam = request.nextUrl.searchParams.get("state");
  const error = request.nextUrl.searchParams.get("error");

  if (error) {
    log.error({ error }, "Google OAuth error in inbox callback");
    return NextResponse.redirect(getSettingsUrl("error=denied"));
  }

  if (!code || !stateParam) {
    return NextResponse.redirect(getSettingsUrl("error=missing_code"));
  }

  if (!verifyState(stateParam, auth.userId)) {
    log.error({ stateParam, userId: auth.userId }, "State mismatch in inbox callback");
    return NextResponse.redirect(getSettingsUrl("error=invalid_state"));
  }

  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;
  if (!clientId || !clientSecret) {
    log.error("Google OAuth credentials not configured");
    return NextResponse.redirect(getSettingsUrl("error=not_configured"));
  }

  try {
    const tokenRes = await fetch(GOOGLE_TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: getRedirectUri(),
        grant_type: "authorization_code",
      }),
    });

    const tokenData = await tokenRes.json();

    if (!tokenRes.ok || !tokenData.refresh_token) {
      log.error({ tokenData }, "Failed to exchange code for tokens in inbox callback");
      return NextResponse.redirect(getSettingsUrl("error=token_exchange"));
    }

    const oauthClient = createOAuth2Client(tokenData.refresh_token);
    oauthClient.setCredentials({
      access_token: tokenData.access_token,
      refresh_token: tokenData.refresh_token,
    });

    const email = await getProfileEmail(oauthClient);
    if (!email) {
      return NextResponse.redirect(getSettingsUrl("error=no_email"));
    }

    const supabase = await createServiceClient();

    // Check if this (user, email) pair already exists.
    const { data: existing } = await supabase
      .from("connected_email_accounts")
      .select("id")
      .eq("user_id", auth.userId)
      .eq("email", email)
      .single();

    const tokenExpiry = tokenData.expires_in
      ? new Date(Date.now() + tokenData.expires_in * 1000).toISOString()
      : null;

    if (existing) {
      await supabase
        .from("connected_email_accounts")
        .update({
          refresh_token: tokenData.refresh_token,
          access_token: tokenData.access_token,
          token_expiry: tokenExpiry,
        })
        .eq("id", existing.id);

      log.info({ email, userId: auth.userId }, "Updated existing inbox Gmail connection");
    } else {
      await supabase.from("connected_email_accounts").insert({
        tenant_id: auth.tenantId,
        user_id: auth.userId,
        provider: "gmail",
        email,
        display_name: email,
        refresh_token: tokenData.refresh_token,
        access_token: tokenData.access_token,
        token_expiry: tokenExpiry,
      });

      log.info({ email, userId: auth.userId }, "Gmail inbox connected");
    }

    return NextResponse.redirect(
      getSettingsUrl(`connected=${encodeURIComponent(email)}`),
    );
  } catch (err) {
    log.error({ err }, "Gmail inbox OAuth callback failed");
    return NextResponse.redirect(getSettingsUrl("error=unknown"));
  }
}
