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
 * POST /api/v1/notifications/read-all
 * Mark all notifications as read for the current user
 */
export async function POST(_request: NextRequest) {
  const requestId = crypto.randomUUID();
  const log = createRequestLogger({
    requestId,
    method: "POST",
    path: "/api/v1/notifications/read-all",
  });

  const auth = await authenticateRequest();
  if (!auth) return apiUnauthorized();

  const supabase = await createServiceClient();

  const { error, count } = await supabase
    .from("notifications")
    .update({ read_at: new Date().toISOString() })
    .eq("tenant_id", auth.tenantId)
    .eq("user_id", auth.userId)
    .is("read_at", null);

  if (error) {
    log.error({ err: error }, "Failed to mark all notifications as read");
    return apiServiceUnavailable("Failed to mark notifications as read");
  }

  log.info({ count }, "All notifications marked as read");

  return apiSuccess({ marked_read: count || 0 });
}
