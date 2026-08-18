import { authenticateRequest, type AuthContext } from "@/lib/api/auth";
import { getFeatureAccess } from "@/industries/_loader";
import { FEATURES } from "@/industries/_registry";
import { apiUnauthorized, apiForbidden } from "@/lib/api/response";
import { isSmsEnabledForTenant } from "./flag";
import { scopedClient, type ScopedClient } from "@/lib/supabase/scoped";

// The single gate every /api/v1/sms/* route runs through, per
// docs/SMS-PHASE3A-BRIEF.md §4:
//   authenticateRequest() -> getFeatureAccess(FEATURES.SMS) -> apiForbidden()
//   -> isSmsEnabledForTenant() -> apiForbidden() -> auth.permissions.canSendSms
//   -> apiForbidden() -> scopedClient(auth)
// canSendSms gates reads as well as writes: the tenant-wide DNC list, blast
// history, and credit balance are not scoped to a counselor's assigned leads,
// so this is an owner/admin (or position-granted) surface end to end.

export type SmsGuardResult =
  | { ok: true; auth: AuthContext; db: ScopedClient }
  | { ok: false; response: Response };

export async function requireSmsAccess(): Promise<SmsGuardResult> {
  const auth = await authenticateRequest();
  if (!auth) return { ok: false, response: apiUnauthorized() };

  if (!getFeatureAccess(auth.industryId, FEATURES.SMS)) {
    return { ok: false, response: apiForbidden() };
  }

  if (!(await isSmsEnabledForTenant(auth.tenantId))) {
    return { ok: false, response: apiForbidden() };
  }

  if (!auth.permissions.canSendSms) {
    return { ok: false, response: apiForbidden("SMS access is required") };
  }

  const db = await scopedClient(auth);
  return { ok: true, auth, db };
}
