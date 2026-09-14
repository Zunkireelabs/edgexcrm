import { NextRequest } from "next/server";
import { authenticateRequest } from "@/lib/api/auth";
import {
  apiSuccess,
  apiUnauthorized,
  apiForbidden,
  apiError,
  apiValidationError,
} from "@/lib/api/response";
import { createRequestLogger } from "@/lib/logger";
import { scopedClient } from "@/lib/supabase/scoped";
import { getFeatureAccess } from "@/industries/_loader";
import { FEATURES } from "@/industries/_registry";
import { createTaskCore } from "@/lib/tasks/create-task";
import { createProjectTaskCore } from "@/lib/tasks/create-project-task";
import { notifyTasksAssignedBatch } from "@/lib/tasks/dispatch-notify";
import { NotificationTypes, createNotificationsExcept } from "@/lib/notifications";

// Round 2 slice E — batch task creation for ⌘K's multi-line paste
// (docs/IT-AGENCY-ROUND2-SLICE-E-CAPTURE-BRIEF.md §3.4). The whole batch is
// validated up front so a bad title/assignee/project writes nothing;
// per-task notifications are suppressed (notify:false on the cores) and
// replaced with exactly ONE in-app notification + ONE digest email for the
// whole batch — a paste for a teammate must not train them to filter EdgeX
// mail the way N separate assignment emails would (§2 decision 2).

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_TITLES = 25;
const MAX_TITLE_LENGTH = 255;

export async function POST(request: NextRequest) {
  const requestId = crypto.randomUUID();
  const log = createRequestLogger({ requestId, method: "POST", path: "/api/v1/my-tasks/bulk" });

  const auth = await authenticateRequest();
  if (!auth) return apiUnauthorized();

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return apiError("INVALID_JSON", "Request body must be valid JSON", 400);
  }

  const errors: Record<string, string[]> = {};
  const titlesRaw = body.titles;
  const titles: string[] = [];

  if (!Array.isArray(titlesRaw) || titlesRaw.length === 0 || titlesRaw.length > MAX_TITLES) {
    errors.titles = [`Must be an array of 1-${MAX_TITLES} titles`];
  } else {
    titlesRaw.forEach((t, i) => {
      const trimmed = typeof t === "string" ? t.trim() : "";
      if (trimmed.length === 0 || trimmed.length > MAX_TITLE_LENGTH) {
        (errors.titles ??= []).push(`Title at index ${i} must be non-empty and at most ${MAX_TITLE_LENGTH} characters`);
      } else {
        titles.push(trimmed);
      }
    });
  }

  const assigneeId = body.assignee_id != null ? String(body.assignee_id) : null;
  if (assigneeId !== null && !UUID_RE.test(assigneeId)) {
    errors.assignee_id = ["Must be a valid UUID or null"];
  }

  const projectId = body.project_id != null ? String(body.project_id) : null;
  if (projectId !== null && !UUID_RE.test(projectId)) {
    errors.project_id = ["Must be a valid UUID or null"];
  }

  if (Object.keys(errors).length > 0) return apiValidationError(errors);

  if (projectId && !getFeatureAccess(auth.industryId, FEATURES.ACCOUNTS)) return apiForbidden();

  const db = await scopedClient(auth);

  // Validate the whole batch before writing anything (brief §3.4).
  if (assigneeId && assigneeId !== auth.userId) {
    const { data: member } = await db.from("tenant_users").select("user_id").eq("user_id", assigneeId).maybeSingle();
    if (!member) return apiValidationError({ assignee_id: ["Not a member of this tenant"] });
  }

  if (projectId) {
    const { data: project } = await db.from("projects").select("id").eq("id", projectId).maybeSingle();
    if (!project) return apiValidationError({ project_id: ["Project not found in this tenant"] });
  }

  const created: Record<string, unknown>[] = [];

  for (const title of titles) {
    const outcome = projectId
      ? await createProjectTaskCore(
          db,
          auth,
          projectId,
          { title, assignee_id: assigneeId },
          { requestId, notify: false, log },
        )
      : await createTaskCore(
          db,
          {
            tenantId: auth.tenantId,
            defaultAssigneeId: auth.userId,
            actorEmail: auth.email,
            industryId: auth.industryId,
          },
          { title, assignee_id: assigneeId },
          { requestId, notify: false },
        );

    if (outcome.kind === "ok") {
      created.push(outcome.task);
    } else {
      // Validated up front — a failure here is a genuine DB error. No
      // rollback: tasks already created (each self-contained, ≤25) stay.
      log.error({ outcome, titlesAttempted: titles.length, created: created.length }, "Bulk task creation failed mid-batch");
      break;
    }
  }

  const failed = titles.length - created.length;
  const finalAssigneeId = assigneeId ?? auth.userId;

  if (created.length > 0 && finalAssigneeId !== auth.userId) {
    const createdTitles = created.map((t) => String(t.title));
    const message =
      createdTitles.length === 1
        ? createdTitles[0]
        : `${createdTitles[0]} and ${createdTitles.length - 1} more`;

    createNotificationsExcept(auth.userId, [
      {
        tenantId: auth.tenantId,
        userId: finalAssigneeId,
        type: NotificationTypes.TASK_ASSIGNED,
        title: `${createdTitles.length} new tasks assigned`,
        message,
        link: "/home",
      },
    ]);
    notifyTasksAssignedBatch(
      {
        db,
        log,
        tenantId: auth.tenantId,
        actorUserId: auth.userId,
        actorEmail: auth.email ?? null,
        industryId: auth.industryId,
      },
      { assigneeUserId: finalAssigneeId, titles: createdTitles, link: "/home" },
    );
  }

  log.info({ created: created.length, failed }, "Bulk tasks created");
  return apiSuccess({ created: created.map((t) => t.id), failed });
}
