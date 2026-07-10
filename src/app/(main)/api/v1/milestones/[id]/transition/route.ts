import { NextRequest } from "next/server";
import { authenticateRequest, requireAdmin } from "@/lib/api/auth";
import { apiSuccess, apiUnauthorized, apiForbidden, apiNotFound, apiError, apiConflict, apiValidationError } from "@/lib/api/response";
import { validate, required, isIn } from "@/lib/api/validation";
import { createRequestLogger } from "@/lib/logger";
import { scopedClient } from "@/lib/supabase/scoped";
import { getFeatureAccess } from "@/industries/_loader";
import { FEATURES } from "@/industries/_registry";
import { recordProjectEvent } from "@/lib/projects/events";
import { createAuditLog } from "@/lib/api/audit";
import type { MilestoneStatus } from "@/types/database";

const MILESTONE_STATUSES = ["pending", "in_progress", "submitted", "accepted", "rejected"];

// Lifecycle transitions this route owns. Approval decisions (→accepted/rejected)
// stay in the accept/reject routes and are deliberately not reachable here.
const LEGAL_TRANSITIONS: Record<MilestoneStatus, MilestoneStatus[]> = {
  pending: ["in_progress", "submitted"],
  in_progress: ["submitted"],
  submitted: ["in_progress"],
  rejected: ["in_progress"],
  accepted: [],
};

interface Props {
  params: Promise<{ id: string }>;
}

export async function POST(request: NextRequest, { params }: Props) {
  const { id } = await params;
  const requestId = crypto.randomUUID();
  const log = createRequestLogger({ requestId, method: "POST", path: `/api/v1/milestones/${id}/transition` });

  const auth = await authenticateRequest();
  if (!auth) return apiUnauthorized();
  if (!getFeatureAccess(auth.industryId, FEATURES.PROJECT_BOARD)) return apiForbidden();
  if (!requireAdmin(auth)) return apiForbidden();

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return apiError("INVALID_JSON", "Request body must be valid JSON", 400);
  }

  const { valid, errors } = validate(body, { to: [required("to"), isIn(MILESTONE_STATUSES)] });
  if (!valid) return apiValidationError(errors);
  const to = body.to as MilestoneStatus;

  const db = await scopedClient(auth);
  const { data: existing } = await db
    .from("project_milestones")
    .select("id, project_id, title, status")
    .eq("id", id)
    .maybeSingle();
  if (!existing) return apiNotFound("Milestone");
  const existingRow = existing as unknown as { project_id: string; title: string; status: MilestoneStatus };
  const current = existingRow.status;

  if (to === "accepted" || to === "rejected") {
    return apiConflict("Use the accept/reject action to decide a milestone.");
  }

  const legal = LEGAL_TRANSITIONS[current] ?? [];
  if (!legal.includes(to)) {
    return apiConflict(`Cannot move milestone from ${current} to ${to}`);
  }

  const patch: Record<string, unknown> = { status: to };
  if (current === "rejected" && to === "in_progress") {
    patch.rejection_reason = null;
  }

  // TOCTOU guard: mirrors accept/reject — a concurrent transition that
  // already changed the status affects 0 rows and bails out below.
  const { data: updated, error } = await db
    .from("project_milestones")
    .update(patch)
    .eq("id", id)
    .eq("status", current)
    .select()
    .maybeSingle();

  if (error) {
    log.error({ error }, "Failed to transition milestone");
    return apiError("DB_ERROR", "Failed to transition milestone", 500);
  }
  if (!updated) {
    return apiConflict("Milestone already moved");
  }

  const eventType = to === "submitted" ? "milestone_submitted" : "milestone_started";
  const summary =
    to === "submitted"
      ? `Milestone submitted for acceptance: ${existingRow.title}`
      : `Milestone moved to in progress: ${existingRow.title}`;

  await Promise.all([
    recordProjectEvent(db, {
      projectId: existingRow.project_id,
      eventType,
      actorId: auth.userId,
      summary,
      payload: { milestone_id: id, from: current, to },
      subjectType: "milestone",
      subjectId: id,
    }),
    createAuditLog({
      tenantId: auth.tenantId,
      userId: auth.userId,
      action: "milestone.transitioned",
      entityType: "milestone",
      entityId: id,
      changes: { status: { old: current, new: to } },
      requestId,
    }),
  ]);

  log.info({ milestoneId: id, from: current, to }, "Milestone transitioned");
  return apiSuccess(updated);
}
