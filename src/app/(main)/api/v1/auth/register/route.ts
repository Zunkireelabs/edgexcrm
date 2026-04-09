import { NextRequest } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import {
  apiSuccess,
  apiValidationError,
  apiError,
  apiServiceUnavailable,
} from "@/lib/api/response";
import { validate, required, isUUID, maxLength } from "@/lib/api/validation";
import { createAuditLog, emitEvent } from "@/lib/api/audit";
import { createRequestLogger } from "@/lib/logger";
import { getClientIp } from "@/lib/api/auth";

/**
 * POST /api/v1/auth/register
 *
 * Creates a new user account using an invite token.
 * - Validates the invite token
 * - Creates Supabase auth user
 * - Accepts the invite (creates tenant_users record)
 * - Returns user info and tenant details
 */
export async function POST(request: NextRequest) {
  const requestId = crypto.randomUUID();
  const ip = getClientIp(request);
  const userAgent = request.headers.get("user-agent") || null;
  const log = createRequestLogger({
    requestId,
    method: "POST",
    path: "/api/v1/auth/register",
    ip,
  });

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return apiValidationError({ body: ["Invalid JSON body"] });
  }

  // Validate input
  const { valid, errors } = validate(body, {
    token: [required("token"), isUUID()],
    password: [required("password"), minLength(8)],
    full_name: [required("full_name"), maxLength(100)],
  });
  if (!valid) return apiValidationError(errors);

  const token = body.token as string;
  const password = body.password as string;
  const fullName = (body.full_name as string).trim();

  const supabase = await createServiceClient();

  // Fetch invite by token with tenant info
  const { data: invite, error: inviteError } = await supabase
    .from("invite_tokens")
    .select(`
      id,
      email,
      role,
      expires_at,
      accepted_at,
      tenant_id,
      tenant:tenants (
        id,
        name,
        slug
      )
    `)
    .eq("token", token)
    .single();

  if (inviteError || !invite) {
    log.warn({ token: token.slice(0, 8) }, "Invalid token");
    return apiError("INVALID_TOKEN", "This invite link is invalid or has been revoked.", 400);
  }

  // Check if already accepted
  if (invite.accepted_at) {
    log.warn({ inviteId: invite.id }, "Token already used");
    return apiError("TOKEN_USED", "This invite has already been used.", 400);
  }

  // Check expiry
  if (new Date(invite.expires_at) < new Date()) {
    log.warn({ inviteId: invite.id }, "Token expired");
    return apiError("TOKEN_EXPIRED", "This invite has expired. Please request a new invitation.", 400);
  }

  // Check if user already exists with this email
  const { data: existingUsers } = await supabase.auth.admin.listUsers();
  const existingUser = existingUsers?.users?.find(
    (u) => u.email?.toLowerCase() === invite.email.toLowerCase()
  );

  if (existingUser) {
    log.warn({ email: invite.email }, "User already exists");
    return apiError(
      "USER_EXISTS",
      "An account with this email already exists. Please login instead.",
      409
    );
  }

  // Create Supabase auth user
  const { data: authData, error: authError } = await supabase.auth.admin.createUser({
    email: invite.email,
    password,
    email_confirm: true, // Auto-confirm since they have a valid invite
    user_metadata: {
      full_name: fullName,
    },
  });

  if (authError || !authData.user) {
    log.error({ err: authError }, "Failed to create auth user");
    return apiServiceUnavailable("Failed to create account. Please try again.");
  }

  const userId = authData.user.id;

  // Create tenant_users record
  const { data: membership, error: memberError } = await supabase
    .from("tenant_users")
    .insert({
      tenant_id: invite.tenant_id,
      user_id: userId,
      role: invite.role,
    })
    .select()
    .single();

  if (memberError) {
    log.error({ err: memberError }, "Failed to create membership");
    // Try to clean up the created user
    await supabase.auth.admin.deleteUser(userId);
    return apiServiceUnavailable("Failed to complete registration. Please try again.");
  }

  // Mark invite as accepted
  await supabase
    .from("invite_tokens")
    .update({ accepted_at: new Date().toISOString() })
    .eq("id", invite.id);

  log.info(
    { inviteId: invite.id, userId, tenantId: invite.tenant_id, role: invite.role },
    "User registered via invite"
  );

  // Fire audit log and event in background
  Promise.all([
    createAuditLog({
      tenantId: invite.tenant_id,
      userId,
      action: "user.registered",
      entityType: "user",
      entityId: userId,
      changes: {
        email: { old: null, new: invite.email },
        role: { old: null, new: invite.role },
        full_name: { old: null, new: fullName },
      },
      ipAddress: ip,
      userAgent,
      requestId,
    }),
    createAuditLog({
      tenantId: invite.tenant_id,
      userId,
      action: "invite.accepted",
      entityType: "invite",
      entityId: invite.id,
      changes: {
        accepted_at: { old: null, new: new Date().toISOString() },
        user_id: { old: null, new: userId },
      },
      ipAddress: ip,
      userAgent,
      requestId,
    }),
    emitEvent({
      tenantId: invite.tenant_id,
      type: "user.registered",
      entityType: "user",
      entityId: userId,
      payload: {
        email: invite.email,
        role: invite.role,
        full_name: fullName,
        invite_id: invite.id,
      },
      requestId,
    }),
  ]);

  return apiSuccess({
    user: {
      id: userId,
      email: invite.email,
      full_name: fullName,
    },
    tenant: invite.tenant,
    role: invite.role,
    membership_id: membership.id,
  }, 201);
}

// Custom validator for minimum length
function minLength(n: number) {
  return (value: unknown) => {
    if (!value || typeof value !== "string") return null;
    if (value.length < n) return `Must be at least ${n} characters`;
    return null;
  };
}
