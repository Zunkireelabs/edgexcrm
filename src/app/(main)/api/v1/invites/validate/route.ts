import { NextRequest } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { apiSuccess, apiValidationError } from "@/lib/api/response";
import { validate, required, isUUID } from "@/lib/api/validation";
import { createRequestLogger } from "@/lib/logger";

/**
 * GET /api/v1/invites/validate?token=xxx
 *
 * Public endpoint - validates an invite token and returns invite details.
 * Does NOT accept the invite, just checks if it's valid.
 */
export async function GET(request: NextRequest) {
  const requestId = crypto.randomUUID();
  const log = createRequestLogger({
    requestId,
    method: "GET",
    path: "/api/v1/invites/validate",
  });

  const { searchParams } = new URL(request.url);
  const token = searchParams.get("token");

  const { valid, errors } = validate({ token }, {
    token: [required("token"), isUUID()],
  });

  if (!valid) {
    return apiValidationError(errors);
  }

  const supabase = await createServiceClient();

  // Fetch invite by token with tenant info
  const { data: invite, error } = await supabase
    .from("invite_tokens")
    .select(`
      id,
      email,
      role,
      expires_at,
      accepted_at,
      tenant:tenants (
        id,
        name,
        slug
      )
    `)
    .eq("token", token)
    .single();

  if (error || !invite) {
    log.info({ token: token?.slice(0, 8) }, "Token not found");
    return apiSuccess({
      valid: false,
      error: "TOKEN_NOT_FOUND",
      message: "This invite link is invalid or has been revoked.",
    });
  }

  // Check if already accepted
  if (invite.accepted_at) {
    log.info({ inviteId: invite.id }, "Token already used");
    return apiSuccess({
      valid: false,
      error: "TOKEN_ALREADY_USED",
      message: "This invite has already been used.",
    });
  }

  // Check expiry
  if (new Date(invite.expires_at) < new Date()) {
    log.info({ inviteId: invite.id }, "Token expired");
    return apiSuccess({
      valid: false,
      error: "TOKEN_EXPIRED",
      message: "This invite has expired. Please request a new invitation.",
    });
  }

  // Valid token - return details
  log.info({ inviteId: invite.id, email: invite.email }, "Token validated");

  // Mask email for privacy (show first 2 chars + domain)
  const [localPart, domain] = invite.email.split("@");
  const maskedEmail = localPart.length > 2
    ? `${localPart.slice(0, 2)}***@${domain}`
    : `${localPart[0]}***@${domain}`;

  return apiSuccess({
    valid: true,
    email: invite.email,
    maskedEmail,
    role: invite.role,
    tenant: invite.tenant,
    expires_at: invite.expires_at,
  });
}
