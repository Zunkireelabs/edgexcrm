import { authenticateRequest } from "@/lib/api/auth";
import { apiUnauthorized, apiForbidden, apiSuccess } from "@/lib/api/response";
import { getFeatureAccess } from "@/industries/_loader";
import { FEATURES } from "@/industries/_registry";
import { resolveVerifiedCompanySender } from "@/lib/email/sender";
import { resolveNoReplySender } from "@/lib/email/no-reply-sender";

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
 *
 * `no_reply` is the tenant's second sender (e.g. no-reply@mail.admizz.com), present only when
 * an admin has set it up on the same verified domain, with what the New email pop-up needs to
 * draw the branded frame and the Preview: the company name, logo, colours and the "Need help?"
 * address. That address is printed in the footer of every email sent from it, so showing it here
 * reveals nothing a recipient doesn't already see.
 */
export async function GET() {
  const auth = await authenticateRequest();
  if (!auth) return apiUnauthorized();
  if (!getFeatureAccess(auth.industryId, FEATURES.EMAIL)) return apiForbidden();

  const sender = await resolveVerifiedCompanySender(auth.tenantId);
  if (!sender) return apiSuccess(null);

  const noReply = await resolveNoReplySender(auth.tenantId);
  return apiSuccess({
    email: sender.address,
    display_name: sender.name,
    no_reply: noReply ? { email: noReply.sender.address, display_name: noReply.sender.name, brand: noReply.brand } : null,
  });
}
