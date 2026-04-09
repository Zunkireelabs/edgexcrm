import { NextRequest } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { authenticateRequest } from "@/lib/api/auth";
import {
  apiSuccess,
  apiUnauthorized,
  apiServiceUnavailable,
} from "@/lib/api/response";
import { createRequestLogger } from "@/lib/logger";

/**
 * GET /api/v1/notifications
 * List notifications for the current user
 */
export async function GET(request: NextRequest) {
  const requestId = crypto.randomUUID();
  const log = createRequestLogger({
    requestId,
    method: "GET",
    path: "/api/v1/notifications",
  });

  const auth = await authenticateRequest();
  if (!auth) return apiUnauthorized();

  const { searchParams } = new URL(request.url);
  const limit = Math.min(parseInt(searchParams.get("limit") || "20"), 50);
  const offset = parseInt(searchParams.get("offset") || "0");
  const unreadOnly = searchParams.get("unread") === "true";

  const supabase = await createServiceClient();

  let query = supabase
    .from("notifications")
    .select("*")
    .eq("tenant_id", auth.tenantId)
    .eq("user_id", auth.userId)
    .order("created_at", { ascending: false })
    .range(offset, offset + limit - 1);

  if (unreadOnly) {
    query = query.is("read_at", null);
  }

  const { data, error } = await query;

  if (error) {
    log.error({ err: error }, "Failed to fetch notifications");
    return apiServiceUnavailable("Failed to fetch notifications");
  }

  // Also get total unread count
  const { count: unreadCount } = await supabase
    .from("notifications")
    .select("*", { count: "exact", head: true })
    .eq("tenant_id", auth.tenantId)
    .eq("user_id", auth.userId)
    .is("read_at", null);

  return apiSuccess({
    notifications: data || [],
    unread_count: unreadCount || 0,
  });
}
