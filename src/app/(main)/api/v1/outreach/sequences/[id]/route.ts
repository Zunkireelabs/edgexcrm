import { NextRequest } from "next/server";
import { authenticateRequest, requireAdmin } from "@/lib/api/auth";
import {
  apiSuccess,
  apiUnauthorized,
  apiForbidden,
  apiNotFound,
  apiError,
  apiValidationError,
  apiConflict,
} from "@/lib/api/response";
import { createRequestLogger } from "@/lib/logger";
import { scopedClient } from "@/lib/supabase/scoped";
import { getFeatureAccess } from "@/industries/_loader";
import { FEATURES } from "@/industries/_registry";
import {
  validateSequenceSteps,
  type SequenceStepInput,
} from "@/industries/_shared/features/outreach/lib/validate-steps";

type Props = { params: Promise<{ id: string }> };

export async function GET(_request: NextRequest, { params }: Props) {
  const { id } = await params;
  const auth = await authenticateRequest();
  if (!auth) return apiUnauthorized();
  if (!getFeatureAccess(auth.industryId, FEATURES.OUTREACH)) return apiForbidden();

  const db = await scopedClient(auth);
  const { data, error } = await db
    .from("email_sequences")
    .select("*, email_sequence_steps(*)")
    .eq("id", id)
    .order("step_order", { referencedTable: "email_sequence_steps", ascending: true })
    .maybeSingle();

  if (error) return apiError("DB_ERROR", "Failed to fetch sequence", 500);
  if (!data) return apiNotFound("Sequence");
  return apiSuccess(data);
}

export async function PATCH(request: NextRequest, { params }: Props) {
  const { id } = await params;
  const requestId = crypto.randomUUID();
  const log = createRequestLogger({ requestId, method: "PATCH", path: "/api/v1/outreach/sequences/[id]" });

  const auth = await authenticateRequest();
  if (!auth) return apiUnauthorized();
  if (!getFeatureAccess(auth.industryId, FEATURES.OUTREACH)) return apiForbidden();
  if (!requireAdmin(auth)) return apiForbidden();

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return apiError("INVALID_JSON", "Request body must be valid JSON", 400);
  }

  const db = await scopedClient(auth);

  const { data: existing } = await db.from("email_sequences").select("id").eq("id", id).maybeSingle();
  if (!existing) return apiNotFound("Sequence");

  const updates: Record<string, unknown> = {};
  if (body.name !== undefined) updates.name = String(body.name).trim();
  if (body.description !== undefined) updates.description = body.description ? String(body.description) : null;

  if (Object.keys(updates).length > 0) {
    const { error: updateError } = await db.from("email_sequences").update(updates).eq("id", id);
    if (updateError) {
      log.error({ error: updateError }, "Failed to update sequence");
      return apiError("DB_ERROR", "Failed to update sequence", 500);
    }
  }

  if (body.steps !== undefined) {
    const stepsError = validateSequenceSteps(body.steps);
    if (stepsError) return apiValidationError({ steps: [stepsError] });

    const { count: liveEnrollmentCount } = await db
      .from("sequence_enrollments")
      .select("id", { count: "exact", head: true })
      .eq("sequence_id", id)
      .in("status", ["active", "paused"]);
    if ((liveEnrollmentCount ?? 0) > 0) {
      return apiConflict("Cannot edit steps while the sequence has active enrollments");
    }

    const { error: deleteError } = await db.from("email_sequence_steps").delete().eq("sequence_id", id);
    if (deleteError) {
      log.error({ error: deleteError }, "Failed to replace sequence steps");
      return apiError("DB_ERROR", "Failed to replace sequence steps", 500);
    }

    const steps = (body.steps as SequenceStepInput[]).map((s) => ({
      sequence_id: id,
      step_order: s.step_order,
      delay_days: s.delay_days ?? 0,
      subject_template: s.subject_template ?? "",
      body_template: s.body_template ?? "",
    }));
    const { error: insertError } = await db.from("email_sequence_steps").insert(steps);
    if (insertError) {
      log.error({ error: insertError }, "Failed to insert sequence steps");
      return apiError("DB_ERROR", "Failed to insert sequence steps", 500);
    }
  }

  const { data: updated } = await db
    .from("email_sequences")
    .select("*, email_sequence_steps(*)")
    .eq("id", id)
    .maybeSingle();

  return apiSuccess(updated);
}

export async function DELETE(_request: NextRequest, { params }: Props) {
  const { id } = await params;
  const auth = await authenticateRequest();
  if (!auth) return apiUnauthorized();
  if (!getFeatureAccess(auth.industryId, FEATURES.OUTREACH)) return apiForbidden();
  if (!requireAdmin(auth)) return apiForbidden();

  const db = await scopedClient(auth);
  const { data: existing } = await db.from("email_sequences").select("id").eq("id", id).maybeSingle();
  if (!existing) return apiNotFound("Sequence");

  const { error } = await db.from("email_sequences").update({ status: "archived" }).eq("id", id);
  if (error) return apiError("DB_ERROR", "Failed to archive sequence", 500);

  return apiSuccess({ id, status: "archived" });
}
