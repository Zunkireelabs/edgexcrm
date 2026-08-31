import { authenticateUser } from "@/lib/api/auth";
import { createServiceClient } from "@/lib/supabase/server";
import { apiSuccess, apiUnauthorized, apiServiceUnavailable } from "@/lib/api/response";
import { createRequestLogger } from "@/lib/logger";

/**
 * GET /api/v1/auth/status
 *
 * Tenant-agnostic check the login page calls right after a successful
 * Supabase sign-in, before navigating into the dashboard — tells it whether
 * this account is blocked (migration 220's tenant_users.suspended_at) so it
 * can show a clear message and sign the session back out instead of letting
 * the person land on the generic "No Organization Found" fallback (which
 * getCurrentUserTenant()/buildUserAuthContext() return for both "no tenant"
 * and "suspended" alike — this endpoint is the one place that tells them
 * apart, without changing either of those two enforcement points).
 *
 * Uses authenticateUser() (no tenant required) rather than authenticateRequest()
 * deliberately: a suspended user has no resolvable AuthContext by design, so
 * authenticateRequest() can't be the thing answering "are you suspended".
 *
 * `blocked: true` reflects the exact same tenant_users.suspended_at column
 * buildUserAuthContext()/getCurrentUserTenant() already check — this is a
 * read-only, additive lookup, not a new enforcement path.
 */
export async function GET() {
  const requestId = crypto.randomUUID();
  const log = createRequestLogger({ requestId, method: "GET", path: "/api/v1/auth/status" });

  const user = await authenticateUser();
  if (!user) return apiUnauthorized();

  const supabase = await createServiceClient();
  const { data, error } = await supabase
    .from("tenant_users")
    .select("suspended_at")
    .eq("user_id", user.userId);

  if (error) {
    log.error({ err: error }, "Failed to check account status");
    return apiServiceUnavailable("Failed to check account status");
  }

  // One tenant per login is the norm (see CLAUDE.md's Tenant model), but this
  // checks every membership row rather than assuming exactly one — a person
  // blocked on ANY membership is treated as blocked here; the login page
  // doesn't yet know which tenant they're signing into.
  const blocked = (data ?? []).some((row) => !!row.suspended_at);

  return apiSuccess({ blocked });
}
