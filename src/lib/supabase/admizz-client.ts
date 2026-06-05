import { createClient } from "@supabase/supabase-js";

// Service-role client for the admizz Supabase project (ldsgsdjixzsljgkcktqu).
// Used by /api/v1/leads to call record_affiliate_conversion when an
// admizz-tenant lead arrives with a ref_code. Lives separately from the CRM's
// own Supabase client (src/lib/supabase/{client,server}.ts) so the two
// projects never get mixed.
//
// Env vars expected (set in .env.local):
//   ADMIZZ_SUPABASE_URL              — https://ldsgsdjixzsljgkcktqu.supabase.co
//   ADMIZZ_SUPABASE_SERVICE_ROLE_KEY — service-role key for that project

const url = process.env.ADMIZZ_SUPABASE_URL ?? "";
const key = process.env.ADMIZZ_SUPABASE_SERVICE_ROLE_KEY ?? "";

if (!url || !key) {
  console.warn(
    "[admizz-client] ADMIZZ_SUPABASE_URL or ADMIZZ_SUPABASE_SERVICE_ROLE_KEY not set. " +
    "Affiliate attribution RPC calls will fail (but lead saves will still succeed)."
  );
}

export const admizzAdminClient = createClient(url, key, {
  auth: { persistSession: false, autoRefreshToken: false },
});
