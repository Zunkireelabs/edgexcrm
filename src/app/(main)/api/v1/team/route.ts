import { authenticateRequest, requireAdmin } from "@/lib/api/auth";
import { scopedClient } from "@/lib/supabase/scoped";
import {
  apiSuccess,
  apiUnauthorized,
  apiForbidden,
  apiServiceUnavailable,
  apiNotFound,
} from "@/lib/api/response";
import { createRequestLogger } from "@/lib/logger";

export async function GET() {
  const requestId = crypto.randomUUID();
  const log = createRequestLogger({
    requestId,
    method: "GET",
    path: "/api/v1/team",
  });

  const auth = await authenticateRequest();
  if (!auth) return apiUnauthorized();

  // Migrated to scopedClient — auto-injects `.eq("tenant_id", auth.tenantId)`.
  // See CLAUDE.md § Hardening discipline.
  const db = await scopedClient(auth);

  const { data: membersRaw, error } = await db
    .from("tenant_users")
    .select("id, user_id, role, default_hourly_rate, created_at")
    .order("created_at", { ascending: true });

  if (error) {
    log.error({ err: error }, "Failed to fetch team members");
    return apiServiceUnavailable("Failed to fetch team members");
  }

  // Row-type inference is dropped by scopedClient.select; cast here.
  const members = (membersRaw ?? []) as unknown as Array<{
    id: string;
    user_id: string;
    role: string;
    default_hourly_rate: number | null;
    created_at: string;
  }>;

  // Fetch user emails from auth.users — uses raw() escape hatch since
  // auth.admin is a service-only API not covered by the tenant scope.
  const { data: authData } = await db.raw().auth.admin.listUsers();
  const userMap = new Map<string, string>();
  for (const u of authData?.users || []) {
    userMap.set(u.id, u.email || "");
  }

  const enriched = members.map((m) => ({
    id: m.id,
    user_id: m.user_id,
    role: m.role,
    email: userMap.get(m.user_id) || "Unknown",
    default_hourly_rate: m.default_hourly_rate,
    created_at: m.created_at,
  }));

  return apiSuccess(enriched);
}

export async function DELETE(request: Request) {
  const requestId = crypto.randomUUID();
  const log = createRequestLogger({
    requestId,
    method: "DELETE",
    path: "/api/v1/team",
  });

  const auth = await authenticateRequest();
  if (!auth) return apiUnauthorized();
  if (!requireAdmin(auth)) return apiForbidden();

  let body: { user_id: string };
  try {
    body = await request.json();
  } catch {
    return apiServiceUnavailable("Invalid JSON body");
  }

  if (!body.user_id) {
    return apiServiceUnavailable("user_id is required");
  }

  // Cannot remove yourself
  if (body.user_id === auth.userId) {
    return apiForbidden();
  }

  // Migrated to scopedClient. The `.eq("user_id", body.user_id)`
  // below is the required additional filter — without it the wrapper
  // would delete every tenant_users row for the tenant.
  const db = await scopedClient(auth);

  const { error } = await db
    .from("tenant_users")
    .delete()
    .eq("user_id", body.user_id);

  if (error) {
    log.error({ err: error }, "Failed to remove team member");
    return apiServiceUnavailable("Failed to remove team member");
  }

  log.info({ userId: body.user_id }, "Team member removed");
  return apiSuccess({ user_id: body.user_id, removed: true });
}

export async function PATCH(request: Request) {
  const requestId = crypto.randomUUID();
  const log = createRequestLogger({
    requestId,
    method: "PATCH",
    path: "/api/v1/team",
  });

  const auth = await authenticateRequest();
  if (!auth) return apiUnauthorized();
  if (!requireAdmin(auth)) return apiForbidden();

  let body: { user_id: string; default_hourly_rate?: number | null };
  try {
    body = await request.json();
  } catch {
    return apiServiceUnavailable("Invalid JSON body");
  }

  if (!body.user_id) {
    return apiServiceUnavailable("user_id is required");
  }

  if (
    body.default_hourly_rate !== undefined &&
    body.default_hourly_rate !== null &&
    (typeof body.default_hourly_rate !== "number" || body.default_hourly_rate < 0)
  ) {
    return apiServiceUnavailable("default_hourly_rate must be a non-negative number or null");
  }

  const db = await scopedClient(auth);

  const { data: existing } = await db
    .from("tenant_users")
    .select("id")
    .eq("user_id", body.user_id)
    .maybeSingle();

  if (!existing) return apiNotFound("Team member");

  const patch: Record<string, unknown> = {};
  if (body.default_hourly_rate !== undefined) {
    patch.default_hourly_rate = body.default_hourly_rate;
  }

  const { data: updated, error } = await db
    .from("tenant_users")
    .update(patch)
    .eq("user_id", body.user_id)
    .select("id, user_id, role, default_hourly_rate, created_at")
    .single();

  if (error) {
    log.error({ err: error }, "Failed to update team member");
    return apiServiceUnavailable("Failed to update team member");
  }

  log.info({ userId: body.user_id }, "Team member updated");
  return apiSuccess(updated);
}
