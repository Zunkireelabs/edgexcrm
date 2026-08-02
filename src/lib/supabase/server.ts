import { createServerClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";
import { cookies } from "next/headers";
import { cache } from "react";
import { fetch as undiciFetch } from "undici";

// Next.js 16.1.6 instruments the global `fetch` and retains each request's store
// (IncrementalCache + requestHeaders + the caller's session cookie) in a WeakMap that
// never releases — ~0.55 MiB of live heap per authenticated dashboard render, which
// OOM-crashed prod roughly hourly. Known upstream bug, clusters on Docker +
// `output: standalone` + fetch (vercel/next.js#88603, #90433, #85914, #64212).
// Routing Supabase through undici's fetch bypasses the instrumented global entirely,
// so no WeakMap entry is created. Safe here: we use none of Next's fetch cache (zero
// unstable_cache/force-cache/revalidate in src/). The global dispatcher configured in
// src/instrumentation.ts still applies, so keep-alive tuning is preserved.
// See docs/MEMORY-LEAK-FIX-BRIEF.md.
const leakFreeFetch = undiciFetch as unknown as typeof globalThis.fetch;

export async function createClient() {
  const cookieStore = await cookies();

  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      global: { fetch: leakFreeFetch },
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

// createServiceClient() used to build a fresh supabase-js client on every call (16 call
// sites in queries.ts alone; the dashboard layout reaches it via getLeadListsByTenant).
// Those per-call clients were what retained the leak: MEASURED at one Next.js request
// store per authenticated dashboard render — 5 -> 205 `IncrementalCache` objects across
// 200 /leads renders — while the SSR createClient() under identical load stayed flat at
// 2 -> 2. Memoizing takes the same gate to 3 -> 3 (VPS) and 4 -> 5 (local), i.e. +200 -> +1.
// This is what OOM-crashed prod ~hourly (05:56 / 07:19 / 09:36 UTC on 2026-08-02).
//
// Memoize the PROMISE, not the client, so concurrent first callers can't each construct one.
// The service-role client carries no user session, so one process-wide instance is safe to
// share: nothing calls setSession() or sets per-request headers on it, and scopedClient()
// wraps it per call without mutating it. See docs/MEMORY-LEAK-FIX-BRIEF.md.
let _serviceClientPromise: Promise<SupabaseClient> | null = null;

export async function createServiceClient() {
  if (!_serviceClientPromise) {
    _serviceClientPromise = (async () => {
      const { createClient } = await import("@supabase/supabase-js");
      return createClient(
        process.env.NEXT_PUBLIC_SUPABASE_URL!,
        process.env.SUPABASE_SERVICE_ROLE_KEY!,
        {
          global: { fetch: leakFreeFetch },
          auth: { persistSession: false, autoRefreshToken: false },
        }
      );
    })();
  }
  return _serviceClientPromise;
}
