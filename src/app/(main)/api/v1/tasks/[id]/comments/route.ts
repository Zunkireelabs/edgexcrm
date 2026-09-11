import { NextRequest } from "next/server";
import { authenticateRequest } from "@/lib/api/auth";
import { apiSuccess, apiUnauthorized, apiNotFound, apiError, apiValidationError } from "@/lib/api/response";
import { createRequestLogger } from "@/lib/logger";
import { scopedClient } from "@/lib/supabase/scoped";
import { createAuditLog } from "@/lib/api/audit";
import { NotificationTypes, createNotificationsExcept } from "@/lib/notifications";

// Round 2 slice C Phase 2 (docs/IT-AGENCY-ROUND2-TASK-PANEL-BRIEF.md §3.2).
//
// ⚠ No getFeatureAccess gate here, on purpose. A task can be a personal task
// in ANY industry (Universal task assignment / Home's My Tasks) — the same
// reason GET /api/v1/my-tasks/[id] is ungated. Gating comments on
// FEATURES.ACCOUNTS would 403 comments for every non-it_agency tenant. The
// sibling [id]/route.ts IS gated (it's the it_agency project-task endpoint
// specifically) — that asymmetry is deliberate, not an oversight.

interface Props {
  params: Promise<{ id: string }>;
}

export async function GET(_request: NextRequest, { params }: Props) {
  const { id } = await params;
  const auth = await authenticateRequest();
  if (!auth) return apiUnauthorized();

  const db = await scopedClient(auth);
  const { data: task } = await db.from("tasks").select("id").eq("id", id).maybeSingle();
  if (!task) return apiNotFound("Task");

  const { data: comments, error } = await db
    .from("task_comments")
    .select("id, task_id, author_id, body, created_at")
    .eq("task_id", id)
    .order("created_at", { ascending: true });

  if (error) return apiError("DB_ERROR", "Failed to fetch comments", 500);
  return apiSuccess(comments ?? []);
}

export async function POST(request: NextRequest, { params }: Props) {
  const { id } = await params;
  const requestId = crypto.randomUUID();
  const log = createRequestLogger({ requestId, method: "POST", path: `/api/v1/tasks/${id}/comments` });

  const auth = await authenticateRequest();
  if (!auth) return apiUnauthorized();

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return apiError("INVALID_JSON", "Request body must be valid JSON", 400);
  }

  if (typeof body.body !== "string") return apiValidationError({ body: ["Must be a string"] });
  const trimmed = body.body.trim();
  if (!trimmed) return apiValidationError({ body: ["body is required"] });
  if (trimmed.length > 2000) return apiValidationError({ body: ["Must be at most 2000 characters"] });

  const db = await scopedClient(auth);
  const { data: task } = await db
    .from("tasks")
    .select("id, title, assignee_id, assigned_by_id")
    .eq("id", id)
    .maybeSingle();
  if (!task) return apiNotFound("Task");
  const taskRow = task as unknown as {
    id: string;
    title: string;
    assignee_id: string | null;
    assigned_by_id: string | null;
  };

  // Any tenant member may comment — matches how open GET is on both task
  // endpoints. A stricter rule here would silence exactly the people we
  // want talking (see the brief's §3.2 rationale).
  const { data: created, error } = await db
    .from("task_comments")
    .insert({ task_id: id, author_id: auth.userId, body: trimmed })
    .select("id, task_id, author_id, body, created_at")
    .single();

  if (error) {
    log.error({ error }, "Failed to create task comment");
    return apiError("DB_ERROR", "Failed to create comment", 500);
  }

  await createAuditLog({
    tenantId: auth.tenantId,
    userId: auth.userId,
    action: "task_comment.created",
    entityType: "task_comment",
    entityId: (created as { id: string }).id,
    requestId,
  });

  const recipients = [taskRow.assignee_id, taskRow.assigned_by_id].filter(
    (uid): uid is string => uid !== null,
  );
  if (recipients.length > 0) {
    createNotificationsExcept(
      auth.userId,
      recipients.map((userId) => ({
        tenantId: auth.tenantId,
        userId,
        type: NotificationTypes.TASK_COMMENTED,
        title: "New comment on a task",
        message: taskRow.title,
        link: `/tasks/${id}`,
      })),
    );
  }

  log.info({ taskId: id }, "Task comment created");
  return apiSuccess(created, 201);
}
