import { authenticateRequest } from "@/lib/api/auth";
import { apiUnauthorized, apiForbidden, apiSuccess } from "@/lib/api/response";
import { getFeatureAccess } from "@/industries/_loader";
import { FEATURES } from "@/industries/_registry";
import { resolveVerifiedCompanySender } from "@/lib/email/sender";

/**
 * GET /api/v1/email/company-sender
 *
 * Whether this tenant has a verified company sender (e.g. hello@mail.admizz.com)
 * that people may pick as the "From" of a one-off email. Separate from
 * /email/inboxes on purpose: that route lists a user's OWN connected Gmail
 * accounts and several screens depend on that exact shape.
 *
 * Open to every user who can use email (any role): the company address is a
 * tenant-level resource, not a personal mailbox. `data` is null when the tenant
 * has no verified sender.
 */
export async function GET() {
  const auth = await authenticateRequest();
  if (!auth) return apiUnauthorized();
  if (!getFeatureAccess(auth.industryId, FEATURES.EMAIL)) return apiForbidden();

  const sender = await resolveVerifiedCompanySender(auth.tenantId);
  return apiSuccess(sender ? { email: sender.address, display_name: sender.name } : null);
}
