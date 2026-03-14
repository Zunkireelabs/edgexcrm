import { createServiceClient } from "@/lib/supabase/server";
import { authenticateRequest, requireAdmin } from "@/lib/api/auth";
import {
  apiSuccess,
  apiUnauthorized,
  apiForbidden,
  apiServiceUnavailable,
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

  const supabase = await createServiceClient();

  const { data: members, error } = await supabase
    .from("tenant_users")
    .select("id, user_id, role, created_at")
    .eq("tenant_id", auth.tenantId)
    .order("created_at", { ascending: true });

  if (error) {
    log.error({ err: error }, "Failed to fetch team members");
    return apiServiceUnavailable("Failed to fetch team members");
  }

  // Fetch user emails from auth.users
  const { data: authData } = await supabase.auth.admin.listUsers();
  const userMap = new Map<string, string>();
  for (const u of authData?.users || []) {
    userMap.set(u.id, u.email || "");
  }

  const enriched = (members || []).map((m) => ({
    id: m.id,
    user_id: m.user_id,
    role: m.role,
    email: userMap.get(m.user_id) || "Unknown",
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

  const supabase = await createServiceClient();

  const { error } = await supabase
    .from("tenant_users")
    .delete()
    .eq("tenant_id", auth.tenantId)
    .eq("user_id", body.user_id);

  if (error) {
    log.error({ err: error }, "Failed to remove team member");
    return apiServiceUnavailable("Failed to remove team member");
  }

  log.info({ userId: body.user_id }, "Team member removed");
  return apiSuccess({ user_id: body.user_id, removed: true });
}
