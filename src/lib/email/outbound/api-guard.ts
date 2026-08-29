import { authenticateRequest, type AuthContext } from "@/lib/api/auth";
import { getFeatureAccess } from "@/industries/_loader";
import { FEATURES } from "@/industries/_registry";
import { apiUnauthorized, apiForbidden } from "@/lib/api/response";
import { isBulkEmailEnabledForTenant } from "./flag";
import { scopedClient, type ScopedClient } from "@/lib/supabase/scoped";

// The single gate every /api/v1/email-blasts/* route runs through
// (OUTREACH-PHASE1-BRIEF.md §5 / §7.2):
//   authenticateRequest() -> getFeatureAccess(FEATURES.EMAIL_CAMPAIGNS) -> apiForbidden()
//   -> isBulkEmailEnabledForTenant() -> apiForbidden() -> scopedClient(auth)
//
// Deliberately does NOT gate on an entitlements key the way SMS's sidebar
// entry does (entitlement: "sms_enabled") — bulk_email_enabled is a COLUMN on
// tenant_email_settings (migration 211), not an entitlement_overrides key.
// Wiring `entitlement: "bulk_email_enabled"` in the manifest would silently
// never match; isBulkEmailEnabledForTenant() reads the real column instead.

export type EmailBlastGuardResult = { ok: true; auth: AuthContext; db: ScopedClient } | { ok: false; response: Response };

export async function requireEmailCampaignsAccess(): Promise<EmailBlastGuardResult> {
  const auth = await authenticateRequest();
  if (!auth) return { ok: false, response: apiUnauthorized() };

  if (!getFeatureAccess(auth.industryId, FEATURES.EMAIL_CAMPAIGNS)) {
    return { ok: false, response: apiForbidden() };
  }

  if (!(await isBulkEmailEnabledForTenant(auth.tenantId))) {
    return { ok: false, response: apiForbidden("Bulk email is not enabled for this tenant") };
  }

  const db = await scopedClient(auth);
  return { ok: true, auth, db };
}
