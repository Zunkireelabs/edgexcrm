import { NextRequest } from "next/server";
import { authenticateRequest, requireAdmin } from "@/lib/api/auth";
import { apiSuccess, apiUnauthorized, apiForbidden, apiNotFound, apiError, apiValidationError } from "@/lib/api/response";
import { validate, optionalMaxLength } from "@/lib/api/validation";
import { createRequestLogger } from "@/lib/logger";
import { scopedClient } from "@/lib/supabase/scoped";
import { getFeatureAccess } from "@/industries/_loader";
import { FEATURES } from "@/industries/_registry";

interface Props {
  params: Promise<{ id: string }>;
}

/**
 * The Phase 1 event contract (brief §2) lists only `milestone_accepted`, not
 * a rejected counterpart — rejection here is a state change, not a ledger
 * event. Flagged to Opus as a possible intentional gap worth symmetric
 * `milestone_rejected` treatment in review.
 */
export async function POST(request: NextRequest, { params }: Props) {
  const { id } = await params;
  const requestId = crypto.randomUUID();
  const log = createRequestLogger({ requestId, method: "POST", path: `/api/v1/milestones/${id}/reject` });

  const auth = await authenticateRequest();
  if (!auth) return apiUnauthorized();
  if (!getFeatureAccess(auth.industryId, FEATURES.PROJECT_BOARD)) return apiForbidden();
  if (!requireAdmin(auth)) return apiForbidden();

  let body: Record<string, unknown> = {};
  try {
    body = (await request.json()) ?? {};
  } catch {
    // No body is fine — a reason is optional.
  }

  const { valid, errors } = validate(body, { reason: [optionalMaxLength(2000)] });
  if (!valid) return apiValidationError(errors);

  const db = await scopedClient(auth);
  const { data: existing } = await db.from("project_milestones").select("id").eq("id", id).maybeSingle();
  if (!existing) return apiNotFound("Milestone");

  const { data: updated, error } = await db
    .from("project_milestones")
    .update({
      status: "rejected",
      rejection_reason: body.reason ? String(body.reason).trim() : null,
      accepted_at: null,
      accepted_by: null,
    })
    .eq("id", id)
    .select()
    .single();

  if (error) {
    log.error({ error }, "Failed to reject milestone");
    return apiError("DB_ERROR", "Failed to reject milestone", 500);
  }

  log.info({ milestoneId: id }, "Milestone rejected");
  return apiSuccess(updated);
}
