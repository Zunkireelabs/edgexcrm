import { NextRequest } from "next/server";
import { authenticateRequest, requireAdmin } from "@/lib/api/auth";
import { apiSuccess, apiUnauthorized, apiForbidden, apiNotFound, apiError } from "@/lib/api/response";
import { createRequestLogger } from "@/lib/logger";
import { scopedClient } from "@/lib/supabase/scoped";
import { createAuditLog } from "@/lib/api/audit";

// See [id]/comments/route.ts's file header for why this route has no
// getFeatureAccess gate — same reasoning applies here.

interface Props {
  params: Promise<{ id: string; commentId: string }>;
}

export async function DELETE(_request: NextRequest, { params }: Props) {
  const { id, commentId } = await params;
  const requestId = crypto.randomUUID();
  const log = createRequestLogger({
    requestId,
    method: "DELETE",
    path: `/api/v1/tasks/${id}/comments/${commentId}`,
  });

  const auth = await authenticateRequest();
  if (!auth) return apiUnauthorized();

  const db = await scopedClient(auth);
  const { data: comment } = await db
    .from("task_comments")
    .select("id, task_id, author_id")
    .eq("id", commentId)
    .maybeSingle();
  if (!comment) return apiNotFound("Comment");

  const commentRow = comment as unknown as { id: string; task_id: string; author_id: string | null };
  if (commentRow.task_id !== id) return apiNotFound("Comment");

  const isAuthor = commentRow.author_id === auth.userId;
  if (!isAuthor && !requireAdmin(auth)) return apiForbidden();

  const { error } = await db.from("task_comments").delete().eq("id", commentId);
  if (error) {
    log.error({ error }, "Failed to delete task comment");
    return apiError("DB_ERROR", "Failed to delete comment", 500);
  }

  await createAuditLog({
    tenantId: auth.tenantId,
    userId: auth.userId,
    action: "task_comment.deleted",
    entityType: "task_comment",
    entityId: commentId,
    requestId,
  });

  log.info({ commentId }, "Task comment deleted");
  return apiSuccess({ id: commentId });
}
