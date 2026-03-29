import { NextRequest } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { authenticateRequest, requireAdmin, getClientIp } from "@/lib/api/auth";
import {
  apiSuccess,
  apiValidationError,
  apiUnauthorized,
  apiForbidden,
  apiConflict,
  apiServiceUnavailable,
} from "@/lib/api/response";
import { validate, required, isEmail, isIn } from "@/lib/api/validation";
import { createAuditLog, emitEvent } from "@/lib/api/audit";
import { createRequestLogger } from "@/lib/logger";

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export async function GET(_request: NextRequest) {
  const requestId = crypto.randomUUID();
  const log = createRequestLogger({
    requestId,
    method: "GET",
    path: "/api/v1/invites",
  });

  const auth = await authenticateRequest();
  if (!auth) return apiUnauthorized();
  if (!requireAdmin(auth)) return apiForbidden();

  const supabase = await createServiceClient();

  const { data, error } = await supabase
    .from("invite_tokens")
    .select("*")
    .eq("tenant_id", auth.tenantId)
    .is("accepted_at", null)
    .gt("expires_at", new Date().toISOString())
    .order("created_at", { ascending: false });

  if (error) {
    log.error({ err: error }, "Failed to fetch invites");
    return apiServiceUnavailable("Failed to fetch invites");
  }

  return apiSuccess(data);
}

export async function POST(request: NextRequest) {
  const requestId = crypto.randomUUID();
  const ip = getClientIp(request);
  const userAgent = request.headers.get("user-agent") || null;
  const log = createRequestLogger({
    requestId,
    method: "POST",
    path: "/api/v1/invites",
    ip,
  });

  const auth = await authenticateRequest();
  if (!auth) return apiUnauthorized();
  if (!requireAdmin(auth)) return apiForbidden();

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return apiValidationError({ body: ["Invalid JSON body"] });
  }

  const { valid, errors } = validate(body, {
    email: [required("email"), isEmail()],
    role: [required("role"), isIn(["admin", "viewer", "counselor"])],
  });
  if (!valid) return apiValidationError(errors);

  const email = (body.email as string).toLowerCase().trim();
  const role = body.role as string;

  const supabase = await createServiceClient();

  // Check if email is already a tenant member by looking up user in auth
  const { data: authLookup } = await supabase.auth.admin.listUsers();
  const matchingUser = authLookup?.users?.find(
    (u) => u.email?.toLowerCase() === email
  );

  if (matchingUser) {
    const { data: membership } = await supabase
      .from("tenant_users")
      .select("id")
      .eq("tenant_id", auth.tenantId)
      .eq("user_id", matchingUser.id)
      .single();

    if (membership) {
      return apiConflict("User is already a member of this tenant");
    }
  }

  // Check for pending unexpired invite for same email + tenant
  const { data: existingInvite } = await supabase
    .from("invite_tokens")
    .select("id")
    .eq("tenant_id", auth.tenantId)
    .eq("email", email)
    .is("accepted_at", null)
    .gt("expires_at", new Date().toISOString())
    .single();

  if (existingInvite) {
    return apiConflict("A pending invite already exists for this email");
  }

  // Generate token and expiry
  const token = crypto.randomUUID();
  const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();

  const { data: invite, error } = await supabase
    .from("invite_tokens")
    .insert({
      tenant_id: auth.tenantId,
      email,
      role,
      token,
      expires_at: expiresAt,
      created_by: auth.userId,
    })
    .select()
    .single();

  if (error) {
    log.error({ err: error }, "Failed to create invite");
    return apiServiceUnavailable("Failed to create invite");
  }

  log.info({ inviteId: invite.id, email, role }, "Invite created");

  Promise.all([
    createAuditLog({
      tenantId: auth.tenantId,
      userId: auth.userId,
      action: "invite.created",
      entityType: "invite",
      entityId: invite.id,
      changes: { email: { old: null, new: email }, role: { old: null, new: role } },
      ipAddress: ip,
      userAgent,
      requestId,
    }),
    emitEvent({
      tenantId: auth.tenantId,
      type: "invite.created",
      entityType: "invite",
      entityId: invite.id,
      payload: { email, role },
      requestId,
    }),
  ]);

  return apiSuccess(invite, 201);
}
