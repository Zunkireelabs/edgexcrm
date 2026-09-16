import { NextRequest } from "next/server";
import { authenticateRequest } from "@/lib/api/auth";
import {
  apiSuccess,
  apiUnauthorized,
  apiForbidden,
  apiNotFound,
  apiError,
  apiValidationError,
} from "@/lib/api/response";
import { createRequestLogger } from "@/lib/logger";
import { scopedClient } from "@/lib/supabase/scoped";
import { getFeatureAccess } from "@/industries/_loader";
import { FEATURES } from "@/industries/_registry";
import { createProjectTaskCore } from "@/lib/tasks/create-project-task";

interface Props {
  params: Promise<{ id: string }>;
}

export async function GET(_request: NextRequest, { params }: Props) {
  const { id: projectId } = await params;
  const auth = await authenticateRequest();
  if (!auth) return apiUnauthorized();
  if (!getFeatureAccess(auth.industryId, FEATURES.ACCOUNTS)) return apiForbidden();

  const db = await scopedClient(auth);

  // Verify project belongs to this tenant
  const { data: project } = await db
    .from("projects")
    .select("id")
    .eq("id", projectId)
    .maybeSingle();
  if (!project) return apiNotFound("Project");

  const { data: tasks, error } = await db
    .from("tasks")
    .select("*")
    .eq("project_id", projectId)
    .order("position", { ascending: true });

  if (error) return apiError("DB_ERROR", "Failed to fetch tasks", 500);
  return apiSuccess(tasks ?? []);
}

// POST is a thin wrapper over createProjectTaskCore (Round 2 slice E,
// docs/IT-AGENCY-ROUND2-SLICE-E-CAPTURE-BRIEF.md §3.4) — the bulk endpoint
// (/api/v1/my-tasks/bulk) calls the same core with notifications suppressed
// and batched. Task creation is open to all tenant members (brief: "let
// employees get started"). Budget/margin-bearing actions stay admin-only
// elsewhere.
export async function POST(request: NextRequest, { params }: Props) {
  const { id: projectId } = await params;
  const requestId = crypto.randomUUID();
  const log = createRequestLogger({
    requestId,
    method: "POST",
    path: `/api/v1/projects/${projectId}/tasks`,
  });

  const auth = await authenticateRequest();
  if (!auth) return apiUnauthorized();
  if (!getFeatureAccess(auth.industryId, FEATURES.ACCOUNTS)) return apiForbidden();

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return apiError("INVALID_JSON", "Request body must be valid JSON", 400);
  }

  const db = await scopedClient(auth);
  const outcome = await createProjectTaskCore(db, auth, projectId, body, { requestId, log });

  if (outcome.kind === "validation") return apiValidationError(outcome.errors);
  if (outcome.kind === "not_found") return apiNotFound("Project");
  if (outcome.kind === "db_error") {
    log.error({ error: outcome.error }, "Failed to create task");
    return apiError("DB_ERROR", "Failed to create task", 500);
  }

  log.info({ taskId: outcome.task.id, assigneeId: outcome.task.assignee_id }, "Task created");
  return apiSuccess(outcome.task, 201);
}
