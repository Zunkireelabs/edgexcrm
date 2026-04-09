import { NextRequest } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { authenticateRequest } from "@/lib/api/auth";
import {
  apiSuccess,
  apiUnauthorized,
  apiNotFound,
  apiServiceUnavailable,
} from "@/lib/api/response";
import { createRequestLogger } from "@/lib/logger";

/**
 * POST /api/v1/notifications/[id]/read
 * Mark a single notification as read
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const requestId = crypto.randomUUID();
  const log = createRequestLogger({
    requestId,
    method: "POST",
    path: `/api/v1/notifications/${id}/read`,
  });

  const auth = await authenticateRequest();
  if (!auth) return apiUnauthorized();

  const supabase = await createServiceClient();

  // Verify notification exists and belongs to user
  const { data: notification } = await supabase
    .from("notifications")
    .select("id")
    .eq("id", id)
    .eq("tenant_id", auth.tenantId)
    .eq("user_id", auth.userId)
    .single();

  if (!notification) {
    return apiNotFound("Notification");
  }

  // Mark as read
  const { error } = await supabase
    .from("notifications")
    .update({ read_at: new Date().toISOString() })
    .eq("id", id);

  if (error) {
    log.error({ err: error }, "Failed to mark notification as read");
    return apiServiceUnavailable("Failed to mark notification as read");
  }

  log.info({ notificationId: id }, "Notification marked as read");

  return apiSuccess({ id, read_at: new Date().toISOString() });
}
