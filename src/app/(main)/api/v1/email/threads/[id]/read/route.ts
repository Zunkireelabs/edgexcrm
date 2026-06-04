import { NextRequest } from "next/server";
import { authenticateRequest } from "@/lib/api/auth";
import {
  apiSuccess,
  apiUnauthorized,
  apiForbidden,
  apiNotFound,
  apiServiceUnavailable,
} from "@/lib/api/response";
import { getFeatureAccess } from "@/industries/_loader";
import { FEATURES } from "@/industries/_registry";
import { scopedClient } from "@/lib/supabase/scoped";
import { createRequestLogger } from "@/lib/logger";

/**
 * PATCH /api/v1/email/threads/[id]/read
 * Mark all inbound emails in a thread as read.
 * Education-only. Counselors may only mark threads they own.
 */
export async function PATCH(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const requestId = crypto.randomUUID();
  const log = createRequestLogger({
    requestId,
    method: "PATCH",
    path: `/api/v1/email/threads/${id}/read`,
  });

  const auth = await authenticateRequest();
  if (!auth) return apiUnauthorized();
  if (!getFeatureAccess(auth.industryId, FEATURES.EMAIL)) return apiForbidden();

  const db = await scopedClient(auth);

  // Counselor scope: verify thread belongs to one of their connected accounts
  if (auth.role === "counselor") {
    const { data: ownAccounts } = await db
      .from("connected_email_accounts")
      .select("id")
      .eq("user_id", auth.userId);
    const ownAccountIds = ((ownAccounts ?? []) as unknown as { id: string }[]).map((a) => a.id);

    if (ownAccountIds.length === 0) {
      return apiNotFound("Thread");
    }

    const { data: thread } = await db
      .from("email_threads")
      .select("id, connected_email_account_id")
      .eq("id", id)
      .maybeSingle();

    const threadRow = thread as { id: string; connected_email_account_id: string } | null;
    if (!threadRow || !ownAccountIds.includes(threadRow.connected_email_account_id)) {
      return apiNotFound("Thread");
    }
  }

  const now = new Date().toISOString();
  const { error } = await db
    .from("emails")
    .update({ read_at: now })
    .eq("thread_id", id)
    .eq("direction", "inbound")
    .is("read_at", null);

  if (error) {
    log.error({ err: error }, "Failed to mark thread emails as read");
    return apiServiceUnavailable("Failed to mark as read");
  }

  log.info({ threadId: id }, "Thread marked as read");
  return apiSuccess({ thread_id: id, read_at: now });
}
