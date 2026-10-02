import { authenticateRequest } from "@/lib/api/auth";
import { apiSuccess, apiUnauthorized, apiForbidden } from "@/lib/api/response";
import { getFeatureAccess } from "@/industries/_loader";
import { FEATURES, INDUSTRIES } from "@/industries/_registry";
import { isBulkEmailEnabledForTenant, isEmailOutboundSandbox } from "@/lib/email/outbound/flag";
import { resolveTenantSender } from "@/lib/email/sender";
import { PLATFORM_EMAIL_ADDRESS } from "@/lib/email";

// GET /api/v1/outreach/send-capability — tells the draft review panel whether to show "Send now"
// and what the confirmation should say. Same shape of check as /ai-draft-status. Not a security
// boundary: POST /drafts/[id]/send re-checks everything server-side.
export async function GET() {
  const auth = await authenticateRequest();
  if (!auth) return apiUnauthorized();
  if (!getFeatureAccess(auth.industryId, FEATURES.OUTREACH)) return apiForbidden();

  const disabled = { enabled: false, sandbox: true, from: null, replyTo: null, usingPlatformAddress: false };
  if (auth.industryId !== INDUSTRIES.EDUCATION_CONSULTANCY) return apiSuccess(disabled);
  if (!(await isBulkEmailEnabledForTenant(auth.tenantId))) return apiSuccess(disabled);

  const sender = await resolveTenantSender(auth.tenantId);
  return apiSuccess({
    enabled: true,
    sandbox: isEmailOutboundSandbox(),
    from: sender.from,
    replyTo: sender.replyTo ?? null,
    // The tenant's own domain isn't verified, so mail goes out from the shared EdgeX address.
    usingPlatformAddress: sender.from.includes(`<${PLATFORM_EMAIL_ADDRESS}>`),
  });
}
