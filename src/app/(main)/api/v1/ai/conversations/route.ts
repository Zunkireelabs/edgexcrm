import { NextRequest } from "next/server";
import { isAssistantEnabled } from "@/lib/ai/flag";
import { authenticateRequest } from "@/lib/api/auth";
import { scopedClient } from "@/lib/supabase/scoped";
import { apiSuccess, apiUnauthorized, apiNotFound, apiServiceUnavailable } from "@/lib/api/response";
import { createRequestLogger } from "@/lib/logger";

/**
 * GET /api/v1/ai/conversations
 * List the current user's own conversations, newest-updated first.
 */
export async function GET(_request: NextRequest) {
  // Flag-off returns the same 404 shape as an unowned/missing conversation —
  // surfaces can't half-work with the assistant disabled.
  if (!isAssistantEnabled()) return apiNotFound();

  const requestId = crypto.randomUUID();
  const log = createRequestLogger({
    requestId,
    method: "GET",
    path: "/api/v1/ai/conversations",
  });

  const auth = await authenticateRequest();
  if (!auth) return apiUnauthorized();

  const db = await scopedClient(auth);

  const { data, error } = await db
    .from("ai_conversations")
    .select("id, title, created_at, updated_at")
    .eq("user_id", auth.userId)
    .order("updated_at", { ascending: false })
    .limit(50);

  if (error) {
    log.error({ err: error }, "Failed to fetch conversations");
    return apiServiceUnavailable("Failed to fetch conversations");
  }

  return apiSuccess({ conversations: data || [] });
}
