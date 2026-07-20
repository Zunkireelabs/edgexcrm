import { authenticateRequest } from "@/lib/api/auth";
import {
  apiUnauthorized,
  apiForbidden,
  apiSuccess,
  apiInternalError,
} from "@/lib/api/response";
import { getFeatureAccess } from "@/industries/_loader";
import { FEATURES } from "@/industries/_registry";
import { scopedClient } from "@/lib/supabase/scoped";
import { revokeToken } from "@/industries/_shared/features/email/lib/gmail-client";
import { decryptAccountToken } from "@/industries/_shared/features/email/lib/token-crypto";
import { logger } from "@/lib/logger";

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const auth = await authenticateRequest();
  if (!auth) return apiUnauthorized();
  if (!getFeatureAccess(auth.industryId, FEATURES.EMAIL)) return apiForbidden();

  const { id } = await params;

  const db = await scopedClient(auth);

  // Load the row first (need the token to revoke below), then delete BEFORE
  // attempting the Google revoke. If delete happened after revoke and then
  // failed, the grant would be dead on Google's side but the row would still
  // sit here as "connected," with no retry path. Deleting first means the
  // worst case if revoke then fails is the pre-existing behavior (grant
  // left live) rather than a new, more confusing stranded state.
  const { data: existing } = await db
    .from("connected_email_accounts")
    .select("id, refresh_token")
    .eq("id", id)
    .eq("user_id", auth.userId)
    .maybeSingle<{ id: string; refresh_token: string }>();

  // Both .eq("id") AND .eq("user_id") required: scopedClient auto-adds tenant_id
  // but the caller must supply the row-level filter; without .eq("id") this would
  // delete every inbox owned by the user in the tenant.
  const { error } = await db
    .from("connected_email_accounts")
    .delete()
    .eq("id", id)
    .eq("user_id", auth.userId);

  if (error) return apiInternalError();

  if (existing) {
    try {
      const revoked = await revokeToken(decryptAccountToken(existing.refresh_token));
      if (!revoked) {
        // Non-fatal: the row is already gone. A lingering Google-side
        // grant is a hygiene gap, not a reason to fail the disconnect.
        logger.warn(
          { account_id: id, user_id: auth.userId },
          "Failed to revoke Google OAuth grant on disconnect",
        );
      }
    } catch (err) {
      // Decrypt can fail too (rotated/misconfigured key) — never let that
      // surface as an error here; the row is already deleted successfully.
      logger.warn(
        { err, account_id: id, user_id: auth.userId },
        "Failed to decrypt token / revoke Google OAuth grant on disconnect",
      );
    }
  }

  return apiSuccess({ deleted: true });
}
