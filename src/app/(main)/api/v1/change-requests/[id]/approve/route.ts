import { NextRequest } from "next/server";
import { authenticateRequest, requireAdmin } from "@/lib/api/auth";
import { apiSuccess, apiUnauthorized, apiForbidden, apiNotFound, apiError, apiConflict } from "@/lib/api/response";
import { createRequestLogger } from "@/lib/logger";
import { scopedClient } from "@/lib/supabase/scoped";
import { getFeatureAccess } from "@/industries/_loader";
import { FEATURES } from "@/industries/_registry";
import { recordProjectEvent } from "@/lib/projects/events";

interface Props {
  params: Promise<{ id: string }>;
}

/**
 * "One scoped write path": this endpoint alone owns the effects of
 * approving a change request — CR status/decided_*, the
 * `projects.current_estimate_minutes` bump, and the ledger event. Supabase's
 * REST layer has no client-side multi-table transaction here (matches the
 * rest of this codebase's junction/child-table routes, which are also
 * sequential writes, not DB transactions) — a concurrent double-approve of
 * the same CR is a known, accepted gap for Phase 1 given `status !==
 * 'proposed'` guards against re-approving an already-decided CR.
 */
export async function POST(request: NextRequest, { params }: Props) {
  const { id } = await params;
  const requestId = crypto.randomUUID();
  const log = createRequestLogger({ requestId, method: "POST", path: `/api/v1/change-requests/${id}/approve` });

  const auth = await authenticateRequest();
  if (!auth) return apiUnauthorized();
  if (!getFeatureAccess(auth.industryId, FEATURES.PROJECT_BOARD)) return apiForbidden();
  if (!requireAdmin(auth)) return apiForbidden();

  let body: Record<string, unknown> = {};
  try {
    body = (await request.json()) ?? {};
  } catch {
    // No body is fine.
  }

  const db = await scopedClient(auth);
  const { data: existing } = await db
    .from("project_change_requests")
    .select("id, project_id, status, title, estimate_delta_minutes, classification, client_approved")
    .eq("id", id)
    .maybeSingle();
  if (!existing) return apiNotFound("Change request");
  const existingRow = existing as unknown as {
    project_id: string;
    status: string;
    title: string;
    estimate_delta_minutes: number;
    classification: string;
    client_approved: boolean;
  };
  if (existingRow.status !== "proposed") {
    return apiConflict(`Change request already ${existingRow.status}`);
  }

  const clientApproved = body.client_approved !== undefined ? Boolean(body.client_approved) : existingRow.client_approved;

  const { data: updatedCr, error: crError } = await db
    .from("project_change_requests")
    .update({
      status: "approved",
      decided_at: new Date().toISOString(),
      decided_by: auth.userId,
      client_approved: clientApproved,
    })
    .eq("id", id)
    .select()
    .single();
  if (crError) {
    log.error({ error: crError }, "Failed to approve change request");
    return apiError("DB_ERROR", "Failed to approve change request", 500);
  }

  const { data: project } = await db
    .from("projects")
    .select("current_estimate_minutes")
    .eq("id", existingRow.project_id)
    .maybeSingle();
  const projectRow = project as unknown as { current_estimate_minutes: number | null } | null;
  const newEstimateMinutes = (projectRow?.current_estimate_minutes ?? 0) + existingRow.estimate_delta_minutes;

  const { error: projectError } = await db
    .from("projects")
    .update({ current_estimate_minutes: newEstimateMinutes })
    .eq("id", existingRow.project_id);
  if (projectError) {
    log.error({ error: projectError }, "Failed to apply change request delta to project estimate");
    return apiError("DB_ERROR", "Failed to update project estimate", 500);
  }

  await recordProjectEvent(db, {
    projectId: existingRow.project_id,
    eventType: "change_request_approved",
    actorId: auth.userId,
    summary: `CR approved: ${existingRow.title} (${existingRow.estimate_delta_minutes >= 0 ? "+" : ""}${Math.round(existingRow.estimate_delta_minutes / 60)}h)`,
    payload: {
      change_request_id: id,
      delta_minutes: existingRow.estimate_delta_minutes,
      classification: existingRow.classification,
      client_approved: clientApproved,
    },
    subjectType: "change_request",
    subjectId: id,
  });

  log.info({ changeRequestId: id, newEstimateMinutes }, "Change request approved");
  return apiSuccess({ change_request: updatedCr, project_current_estimate_minutes: newEstimateMinutes });
}
