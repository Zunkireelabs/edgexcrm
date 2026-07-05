import { NextRequest } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { authenticateRequest, getClientIp } from "@/lib/api/auth";
import { apiSuccess, apiUnauthorized, apiForbidden, apiNotFound, apiServiceUnavailable } from "@/lib/api/response";
import { createRequestLogger } from "@/lib/logger";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const log = createRequestLogger({
    requestId: crypto.randomUUID(),
    method: "GET",
    path: `/api/v1/leads/${id}/collaborators`,
    ip: getClientIp(request),
  });

  const auth = await authenticateRequest();
  if (!auth) return apiUnauthorized();
  if (auth.permissions.baseTier !== "owner" && auth.permissions.baseTier !== "admin") {
    return apiForbidden();
  }

  const supabase = await createServiceClient();

  const { data: lead } = await supabase
    .from("leads")
    .select("id")
    .eq("id", id)
    .eq("tenant_id", auth.tenantId)
    .is("deleted_at", null)
    .single();
  if (!lead) return apiNotFound("Lead");

  const { data: rows, error } = await supabase
    .from("lead_collaborators")
    .select("user_id, created_at")
    .eq("tenant_id", auth.tenantId)
    .eq("lead_id", id)
    .order("created_at", { ascending: true });

  if (error) {
    log.error({ err: error }, "Failed to fetch collaborators");
    return apiServiceUnavailable("Failed to fetch collaborators");
  }

  const userIds = (rows ?? []).map((r: { user_id: string }) => r.user_id);

  // Resolve names in parallel — collaborator counts are small (typically 2–10)
  const resolved = await Promise.all(
    userIds.map(async (userId) => {
      const { data: u } = await supabase.auth.admin.getUserById(userId);
      const email = u?.user?.email ?? "";
      const meta = u?.user?.user_metadata as Record<string, unknown> | undefined;
      const name =
        (meta?.full_name as string | undefined) ||
        (meta?.name as string | undefined) ||
        email.split("@")[0] ||
        "Unknown";
      return { user_id: userId, email, name };
    }),
  );

  return apiSuccess({ collaborators: resolved });
}
