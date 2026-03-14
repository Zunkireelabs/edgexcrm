import { NextRequest } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { authenticateUser, getClientIp } from "@/lib/api/auth";
import {
  apiSuccess,
  apiValidationError,
  apiUnauthorized,
  apiForbidden,
  apiConflict,
  apiServiceUnavailable,
} from "@/lib/api/response";
import { validate, required } from "@/lib/api/validation";
import { createAuditLog, emitEvent } from "@/lib/api/audit";
import { createRequestLogger } from "@/lib/logger";

export async function POST(request: NextRequest) {
  const requestId = crypto.randomUUID();
  const ip = getClientIp(request);
  const userAgent = request.headers.get("user-agent") || null;
  const log = createRequestLogger({
    requestId,
    method: "POST",
    path: "/api/v1/invites/accept",
    ip,
  });

  // Use authenticateUser (no tenant required)
  const user = await authenticateUser();
  if (!user) return apiUnauthorized();

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return apiValidationError({ body: ["Invalid JSON body"] });
  }

  const { valid, errors } = validate(body, {
    token: [required("token")],
  });
  if (!valid) return apiValidationError(errors);

  const token = body.token as string;

  const supabase = await createServiceClient();

  // Fetch invite by token
  const { data: invite } = await supabase
    .from("invite_tokens")
    .select("*")
    .eq("token", token)
    .is("accepted_at", null)
    .single();

  if (!invite) {
    return apiValidationError({ token: ["Invalid or already used invite token"] });
  }

  // Check expiry
  if (new Date(invite.expires_at) < new Date()) {
    return apiValidationError({ token: ["Invite token has expired"] });
  }

  // Check email matches
  if (invite.email.toLowerCase() !== user.email.toLowerCase()) {
    return apiForbidden();
  }

  // Check not already a member
  const { data: existingMembership } = await supabase
    .from("tenant_users")
    .select("id")
    .eq("tenant_id", invite.tenant_id)
    .eq("user_id", user.userId)
    .single();

  if (existingMembership) {
    return apiConflict("You are already a member of this tenant");
  }

  // Insert tenant_users record
  const { data: membership, error: memberError } = await supabase
    .from("tenant_users")
    .insert({
      tenant_id: invite.tenant_id,
      user_id: user.userId,
      role: invite.role,
    })
    .select()
    .single();

  if (memberError) {
    log.error({ err: memberError }, "Failed to create membership");
    return apiServiceUnavailable("Failed to accept invite");
  }

  // Mark invite as accepted
  await supabase
    .from("invite_tokens")
    .update({ accepted_at: new Date().toISOString() })
    .eq("id", invite.id);

  log.info(
    { inviteId: invite.id, userId: user.userId, tenantId: invite.tenant_id },
    "Invite accepted"
  );

  Promise.all([
    createAuditLog({
      tenantId: invite.tenant_id,
      userId: user.userId,
      action: "invite.accepted",
      entityType: "invite",
      entityId: invite.id,
      changes: {
        accepted_at: { old: null, new: new Date().toISOString() },
        user_id: { old: null, new: user.userId },
      },
      ipAddress: ip,
      userAgent,
      requestId,
    }),
    emitEvent({
      tenantId: invite.tenant_id,
      type: "invite.accepted",
      entityType: "invite",
      entityId: invite.id,
      payload: {
        email: invite.email,
        role: invite.role,
        user_id: user.userId,
      },
      requestId,
    }),
  ]);

  return apiSuccess({
    tenant_id: invite.tenant_id,
    user_id: user.userId,
    role: invite.role,
    membership_id: membership.id,
  });
}
