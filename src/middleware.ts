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

  // Skip auth for public proposal share links — no session needed
  if (request.nextUrl.pathname.startsWith("/proposals/share")) {
    return NextResponse.next();
  }

  return await updateSession(request);
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
