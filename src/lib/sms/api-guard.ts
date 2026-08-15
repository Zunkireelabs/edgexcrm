import { authenticateRequest, type AuthContext } from "@/lib/api/auth";
import { getFeatureAccess } from "@/industries/_loader";
import { FEATURES } from "@/industries/_registry";
import { apiUnauthorized, apiForbidden } from "@/lib/api/response";
import { isSmsEnabledForTenant } from "./flag";
import { scopedClient, type ScopedClient } from "@/lib/supabase/scoped";

// The single gate every /api/v1/sms/* route runs through, per
// docs/SMS-PHASE3A-BRIEF.md §4:
//   authenticateRequest() -> getFeatureAccess(FEATURES.SMS) -> apiForbidden()
//   -> isSmsEnabledForTenant() -> apiForbidden() -> scopedClient(auth)
// Write routes additionally pass requireSend: true to also require
// auth.permissions.canSendSms.

export type SmsGuardResult =
  | { ok: true; auth: AuthContext; db: ScopedClient }
  | { ok: false; response: Response };

export async function requireSmsAccess(opts: { requireSend?: boolean } = {}): Promise<SmsGuardResult> {
  const auth = await authenticateRequest();
  if (!auth) return { ok: false, response: apiUnauthorized() };

  if (!getFeatureAccess(auth.industryId, FEATURES.SMS)) {
    return { ok: false, response: apiForbidden() };
  }

  if (!(await isSmsEnabledForTenant(auth.tenantId))) {
    return { ok: false, response: apiForbidden() };
  }

  if (opts.requireSend && !auth.permissions.canSendSms) {
    return { ok: false, response: apiForbidden("SMS send access is required") };
  }

  const db = await scopedClient(auth);
  return { ok: true, auth, db };
}
