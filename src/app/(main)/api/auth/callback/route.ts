import { NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  // Default to "/" so the root route makes the industry-aware landing choice
  // (education → /home, else /dashboard). An explicit ?next= still wins.
  const next = searchParams.get("next") ?? "/";

  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      // Same blocked-account check as the password-login path
      // (src/app/(main)/(auth)/login/page.tsx) — OAuth (Google/Microsoft/Apple)
      // exchanges the code and establishes a session directly here, bypassing
      // the login page's own status check entirely. Without this, a suspended
      // user signing in via OAuth would land straight on the dashboard's
      // generic "No Organization Found" fallback (getCurrentUserTenant()
      // still blocks them for real) with no explanation why — same gap the
      // /api/v1/auth/status endpoint closes for password login, just at this
      // second entry point.
      const { data: { user } } = await supabase.auth.getUser();
      if (user) {
        const serviceClient = await createServiceClient();
        const { data } = await serviceClient
          .from("tenant_users")
          .select("suspended_at")
          .eq("user_id", user.id);
        const blocked = (data ?? []).some((row) => !!row.suspended_at);
        if (blocked) {
          await supabase.auth.signOut();
          return NextResponse.redirect(`${origin}/login?error=suspended`);
        }
      }
      return NextResponse.redirect(`${origin}${next}`);
    }
  }

  return NextResponse.redirect(`${origin}/login?error=auth_failed`);
}
