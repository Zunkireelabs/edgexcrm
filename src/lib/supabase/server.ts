import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { cache } from "react";

export async function createClient() {
  const cookieStore = await cookies();

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            );
          } catch {
            // The `setAll` method was called from a Server Component.
            // This can be ignored if you have middleware refreshing sessions.
          }
        },
      },
    }
  );
}

export type CachedUser = {
  id: string;
  email: string | undefined;
  user_metadata: Record<string, unknown> | undefined;
};

// getClaims() verifies the JWT locally (WebCrypto against the project's cached JWKS) instead
// of getUser()'s network round-trip to Supabase. It only falls back to a network call itself
// when the token is HS256-signed, has no kid, or WebCrypto is unavailable — see docs perf
// brief. React's cache() dedupes this to one call per server render pass, so a layout + page
// that both need the session share a single verification instead of paying it once each.
export const getCachedUser = cache(async (): Promise<CachedUser | null> => {
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getClaims();
  if (error || !data) return null;

  const { claims } = data;
  return {
    id: claims.sub,
    email: claims.email,
    user_metadata: claims.user_metadata,
  };
});

export async function createServiceClient() {
  const { createClient } = await import("@supabase/supabase-js");
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );
}
