// POST /api/public/chat/session   body: { inbox: "<public inbox identifier>" }
// The branded chat widget calls this first. See src/lib/inbox/website-chat/session.ts for what it checks and returns.
//
// CORS: the preflight answers "*" because it carries no body, so the inbox (and so the allowed website) is not known yet and
// it reveals nothing. The real response names the one allowed origin, never "*", and only on success.

import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { getClientIp } from "@/lib/api/auth";
import { apiError, apiRateLimited, apiSuccess } from "@/lib/api/response";
import { createChatSession } from "@/lib/inbox/website-chat/session";

const PREFLIGHT_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Max-Age": "600",
};

export function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: PREFLIGHT_HEADERS });
}

export async function POST(request: NextRequest) {
  const body = (await request.json().catch(() => null)) as { inbox?: unknown } | null;

  // Public route: no session to scope by, so the service client is used for the one row looked up by its public identifier.
  const result = await createChatSession({
    db: await createServiceClient(),
    inboxIdentifier: body?.inbox,
    origin: request.headers.get("origin"),
    ip: getClientIp(request),
  });

  if (!result.ok) {
    const response = result.status === 429 ? apiRateLimited(result.retryAfterSeconds ?? 60) : apiError(result.code, result.message, result.status);
    response.headers.set("Cache-Control", "no-store");
    return response;
  }

  const response = apiSuccess(result.session);
  response.headers.set("Access-Control-Allow-Origin", result.origin);
  response.headers.set("Vary", "Origin");
  response.headers.set("Cache-Control", "no-store");
  return response;
}
