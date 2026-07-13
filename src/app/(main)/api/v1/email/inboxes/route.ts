import { authenticateRequest } from "@/lib/api/auth";
import { apiUnauthorized, apiForbidden, apiSuccess, apiInternalError } from "@/lib/api/response";
import { getFeatureAccess } from "@/industries/_loader";
import { FEATURES } from "@/industries/_registry";
import { scopedClient } from "@/lib/supabase/scoped";

// 3+ consecutive poll failures (~6-15 min at current cron cadence) before we
// flag an inbox as broken — enough to ride out a single transient Google API
// blip without false-positiving, since a successful poll resets the count to 0.
const ERROR_STREAK_THRESHOLD = 3;

interface SyncStateRow {
  connected_email_account_id: string;
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
}

export async function GET() {
  const auth = await authenticateRequest();
  if (!auth) return apiUnauthorized();
  if (!getFeatureAccess(auth.industryId, FEATURES.EMAIL)) return apiForbidden();

  const db = await scopedClient(auth);
  const { data, error } = await db
    .from("connected_email_accounts")
    .select("id, email, display_name, provider, created_at")
    .eq("user_id", auth.userId);

  if (error) return apiInternalError();

  const accounts = (data ?? []) as unknown as AccountRow[];
  if (accounts.length === 0) return apiSuccess([]);

  // email_sync_state has no tenant_id column (it's keyed 1:1 on
  // connected_email_account_id), so it can't go through scopedClient's
  // auto tenant-filter — use fromGlobal() and filter explicitly to this
  // user's own account ids instead.
  const accountIds = accounts.map((a) => a.id);
  const { data: syncStates } = await db
    .fromGlobal("email_sync_state")
    .select("connected_email_account_id, consecutive_error_count, last_error, last_synced_at")
    .in("connected_email_account_id", accountIds);

  const stateByAccountId = new Map<string, SyncStateRow>(
    ((syncStates ?? []) as SyncStateRow[]).map((s) => [s.connected_email_account_id, s]),
  );

  const enriched = accounts.map((account) => {
    const state = stateByAccountId.get(account.id);
    const needsReconnect = (state?.consecutive_error_count ?? 0) >= ERROR_STREAK_THRESHOLD;
    return {
      ...account,
      health: needsReconnect ? ("error" as const) : ("ok" as const),
      last_synced_at: state?.last_synced_at ?? null,
      last_error: needsReconnect ? state?.last_error ?? null : null,
    };
  });

  return apiSuccess(enriched);
}
