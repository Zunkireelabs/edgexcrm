import { NextRequest } from "next/server";
import { authenticateRequest, requireAdmin } from "@/lib/api/auth";
import {
  apiSuccess,
  apiUnauthorized,
  apiForbidden,
  apiError,
  apiValidationError,
} from "@/lib/api/response";
import { validate, required, maxLength } from "@/lib/api/validation";
import { createRequestLogger } from "@/lib/logger";
import { scopedClient } from "@/lib/supabase/scoped";
import { getFeatureAccess } from "@/industries/_loader";
import { FEATURES } from "@/industries/_registry";
import {
  validateSequenceSteps,
  type SequenceStepInput,
} from "@/industries/_shared/features/outreach/lib/validate-steps";

export async function GET() {
  const auth = await authenticateRequest();
  if (!auth) return apiUnauthorized();
  if (!getFeatureAccess(auth.industryId, FEATURES.OUTREACH)) return apiForbidden();

  const db = await scopedClient(auth);
  const { data, error } = await db
    .from("email_sequences")
    .select("*, email_sequence_steps(*)")
    .eq("status", "active")
    .order("step_order", { referencedTable: "email_sequence_steps", ascending: true })
    .order("created_at", { ascending: false });

  if (error) return apiError("DB_ERROR", "Failed to fetch sequences", 500);
  return apiSuccess(data ?? []);
}

export async function POST(request: NextRequest) {
  const requestId = crypto.randomUUID();
  const log = createRequestLogger({ requestId, method: "POST", path: "/api/v1/outreach/sequences" });

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

  const { valid, errors } = validate(body, {
    name: [required("name"), maxLength(200)],
  });
  if (!valid) return apiValidationError(errors);

  const stepsError = validateSequenceSteps(body.steps);
  if (stepsError) return apiValidationError({ steps: [stepsError] });

  const db = await scopedClient(auth);

  const { data: sequence, error: seqError } = await db
    .from("email_sequences")
    .insert({
      name: String(body.name).trim(),
      description: body.description ? String(body.description) : null,
      created_by: auth.userId,
    })
    .select("*")
    .single();

  if (seqError || !sequence) {
    log.error({ error: seqError }, "Failed to create sequence");
    return apiError("DB_ERROR", "Failed to create sequence", 500);
  }

  const sequenceRow = sequence as { id: string };
  const steps = (body.steps as SequenceStepInput[]).map((s) => ({
    sequence_id: sequenceRow.id,
    step_order: s.step_order,
    delay_days: s.delay_days ?? 0,
    subject_template: s.subject_template ?? "",
    body_template: s.body_template ?? "",
  }));

  const { data: createdSteps, error: stepsInsertError } = await db
    .from("email_sequence_steps")
    .insert(steps)
    .select("*");

  if (stepsInsertError) {
    log.error({ error: stepsInsertError }, "Failed to create sequence steps");
    return apiError("DB_ERROR", "Failed to create sequence steps", 500);
  }

  log.info({ sequenceId: sequenceRow.id }, "Sequence created");
  return apiSuccess({ ...sequence, email_sequence_steps: createdSteps ?? [] }, 201);
}
