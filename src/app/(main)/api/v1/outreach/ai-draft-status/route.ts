import { authenticateRequest } from "@/lib/api/auth";
import { apiSuccess, apiUnauthorized, apiForbidden } from "@/lib/api/response";
import { getFeatureAccess } from "@/industries/_loader";
import { FEATURES } from "@/industries/_registry";
import { isOutreachDraftEnabledForTenant } from "@/lib/ai/flag";

// GET /api/v1/outreach/ai-draft-status — tiny capability check so client
// components (the draft review panel can be opened from the outreach cockpit
// OR the lead-detail cadence strip, two separate render trees) can decide
// whether to show "Draft with AI" without duplicating the D5 gate check.
export async function GET() {
  const auth = await authenticateRequest();
  if (!auth) return apiUnauthorized();
  if (!getFeatureAccess(auth.industryId, FEATURES.OUTREACH)) return apiForbidden();

  const enabled = await isOutreachDraftEnabledForTenant(auth.tenantId);
  return apiSuccess({ enabled });
}
