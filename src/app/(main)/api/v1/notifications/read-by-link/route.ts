import { NextRequest } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { authenticateRequest } from "@/lib/api/auth";
import {
  apiSuccess,
  apiUnauthorized,
  apiError,
  apiServiceUnavailable,
} from "@/lib/api/response";
import { createRequestLogger } from "@/lib/logger";

/**
 * POST /api/v1/notifications/read-by-link
 * Body: { link: string }
 * Marks all of the current user's unread notifications pointing at `link` as
 * read. Used when a user opens a resource (e.g. a lead detail page) so its
 * notifications — like a "New lead" — clear, the way opening a message thread
 * clears its unread count.
 */
export async function POST(request: NextRequest) {
  const requestId = crypto.randomUUID();
  const log = createRequestLogger({
    requestId,
    method: "POST",
    path: "/api/v1/notifications/read-by-link",
  });

  const auth = await authenticateRequest();
  if (!auth) return apiUnauthorized();

  let link: unknown;
  try {
    ({ link } = await request.json());
  } catch {
    return apiError("INVALID_BODY", "Invalid JSON body", 400);
  }
  if (typeof link !== "string" || link.length === 0) {
    return apiError("INVALID_BODY", "link is required", 400);
  }

  const supabase = await createServiceClient();

  const { error, count } = await supabase
    .from("notifications")
    .update({ read_at: new Date().toISOString() })
    .eq("tenant_id", auth.tenantId)
    .eq("user_id", auth.userId)
    .eq("link", link)
    .is("read_at", null);

  if (error) {
    log.error({ err: error }, "Failed to mark notifications read by link");
    return apiServiceUnavailable("Failed to mark notifications as read");
  }

  return apiSuccess({ marked_read: count || 0 });
}
