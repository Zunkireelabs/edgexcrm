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

  // Load the row first so we can revoke the Google grant before removing
  // it locally — without this, "Disconnect" only forgets the credential
  // here; the grant stays live under the user's Google Account.
  const { data: existing } = await db
    .from("connected_email_accounts")
    .select("id, refresh_token")
    .eq("id", id)
    .eq("user_id", auth.userId)
    .maybeSingle<{ id: string; refresh_token: string }>();

  if (existing) {
    const revoked = await revokeToken(decryptAccountToken(existing.refresh_token));
    if (!revoked) {
      // Non-fatal: still remove the local row. A lingering Google-side
      // grant is a hygiene gap, not a reason to block disconnecting.
      logger.warn(
        { account_id: id, user_id: auth.userId },
        "Failed to revoke Google OAuth grant on disconnect",
      );
    }
  }

  // Both .eq("id") AND .eq("user_id") required: scopedClient auto-adds tenant_id
  // but the caller must supply the row-level filter; without .eq("id") this would
  // delete every inbox owned by the user in the tenant.
  const { error } = await db
    .from("connected_email_accounts")
    .delete()
    .eq("id", id)
    .eq("user_id", auth.userId);

  if (error) return apiInternalError();

  return apiSuccess({ deleted: true });
}
