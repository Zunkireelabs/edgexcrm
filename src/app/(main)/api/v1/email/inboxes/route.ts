import { authenticateRequest } from "@/lib/api/auth";
import { apiUnauthorized, apiForbidden, apiSuccess, apiInternalError } from "@/lib/api/response";
import { getFeatureAccess } from "@/industries/_loader";
import { FEATURES } from "@/industries/_registry";
import { scopedClient } from "@/lib/supabase/scoped";

// 3+ consecutive poll failures (~15+ min at the prod cron's real cadence —
// GitHub Actions scheduled workflows have a ~5-minute floor regardless of
// what the cron expression requests, and can run later still under platform
// load) before we flag an inbox as broken — enough to ride out a single
// transient Google API blip without false-positiving, since a successful
// poll resets the count to 0.
const ERROR_STREAK_THRESHOLD = 3;

interface SyncStateRow {
  consecutive_error_count: number;
  last_error: string | null;
  last_synced_at: string | null;
}

interface AccountRow {
  id: string;
  email: string;
  display_name: string | null;
  provider: string;
  created_at: string;
  // email_sync_state.connected_email_account_id is both PK and FK to this
  // table, so PostgREST embeds it as a single object — stay defensive in
  // case the client library ever returns a single-element array instead.
  email_sync_state: SyncStateRow | SyncStateRow[] | null;
}

export async function GET() {
  const auth = await authenticateRequest();
  if (!auth) return apiUnauthorized();
  if (!getFeatureAccess(auth.industryId, FEATURES.EMAIL)) return apiForbidden();

  const db = await scopedClient(auth);
  const { data, error } = await db
    .from("connected_email_accounts")
    .select(
      "id, email, display_name, provider, created_at, email_sync_state(consecutive_error_count, last_error, last_synced_at)",
    )
    .eq("user_id", auth.userId);

  if (error) return apiInternalError();

  const accounts = (data ?? []) as unknown as AccountRow[];

  const enriched = accounts.map((account) => {
    const rawState = account.email_sync_state;
    const state = Array.isArray(rawState) ? rawState[0] : rawState;
    const needsReconnect = (state?.consecutive_error_count ?? 0) >= ERROR_STREAK_THRESHOLD;
    return {
      id: account.id,
      email: account.email,
      display_name: account.display_name,
      provider: account.provider,
      created_at: account.created_at,
      health: needsReconnect ? ("error" as const) : ("ok" as const),
      last_synced_at: state?.last_synced_at ?? null,
      last_error: needsReconnect ? state?.last_error ?? null : null,
    };
  });

  return apiSuccess(enriched);
}
