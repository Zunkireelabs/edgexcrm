import { NextResponse, type NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";

export async function middleware(request: NextRequest) {
  // Skip auth entirely for public form routes — no session needed
  if (request.nextUrl.pathname.startsWith("/form")) {
    return NextResponse.next();
  }

  // Skip auth for public consent signing routes — no session needed
  if (request.nextUrl.pathname.startsWith("/consent")) {
    return NextResponse.next();
  }

  // Skip auth for the public SMS opt-out link — no session needed. Carrier
  // link-scanners fetch this before any human does; it must never redirect
  // to /login.
  if (request.nextUrl.pathname.startsWith("/u/")) {
    return NextResponse.next();
  }

  // Skip auth for the public email unsubscribe link — no session needed, for
  // the same reason as the SMS opt-out link above. Mail-client link-scanners
  // (Gmail, Outlook) fetch List-Unsubscribe URLs before any human does; it
  // must never redirect to /login.
  if (request.nextUrl.pathname.startsWith("/e/u/")) {
    return NextResponse.next();
  }

  // Skip auth for public proposal share links — no session needed
  if (request.nextUrl.pathname.startsWith("/proposals/share")) {
    return NextResponse.next();
  }

  // Skip auth for public status report share links — no session needed
  if (request.nextUrl.pathname.startsWith("/reports/share")) {
    return NextResponse.next();
  }

  return await updateSession(request);
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
