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
import { ON_REPLY_VALUES, type OnReply } from "@/industries/_shared/features/outreach/lib/stop-on-reply";
import { validateSendWindow } from "@/industries/_shared/features/outreach/lib/send-window";
import { checkStepEdit, lockedUpToStep, stepsLockedMessage } from "@/industries/_shared/features/outreach/lib/step-edit-rules";

type Props = { params: Promise<{ id: string }> };

/**
 * How far into this sequence running leads have got: steps 1..lockedUpTo are in use (see step-edit-rules.ts). Counts
 * active AND paused enrollments. `live` is how many leads that is.
 */
async function loadStepLock(
  db: Awaited<ReturnType<typeof scopedClient>>,
  sequenceId: string,
  stepCount: number
): Promise<{ lockedUpTo: number; live: number }> {
  const { data: furthest } = await db
    .from("sequence_enrollments")
    .select("current_step_order")
    .eq("sequence_id", sequenceId)
    .in("status", ["active", "paused"])
    .order("current_step_order", { ascending: false })
    .limit(1)
    .maybeSingle();
  const max = (furthest as unknown as { current_step_order: number } | null)?.current_step_order ?? null;

  const { count } = await db
    .from("sequence_enrollments")
    .select("id", { count: "exact", head: true })
    .eq("sequence_id", sequenceId)
    .in("status", ["active", "paused"]);

  return { lockedUpTo: lockedUpToStep(max, stepCount), live: count ?? 0 };
}

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

  // Which steps running leads depend on — the editor locks those steps' structure (their wording stays editable).
  const steps = (data as unknown as { email_sequence_steps?: unknown[] }).email_sequence_steps ?? [];
  const lock = await loadStepLock(db, id, steps.length);
  return apiSuccess({ ...(data as object), locked_up_to: lock.lockedUpTo, live_enrollments: lock.live });
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

  if (body.on_reply !== undefined && !ON_REPLY_VALUES.includes(body.on_reply as OnReply)) {
    return apiValidationError({ on_reply: ["Must be one of: pause, end, continue"] });
  }

  // Only validated when sent; an edit that doesn't mention it leaves the stored window alone.
  const sendWindow = body.send_window !== undefined ? validateSendWindow(body.send_window) : null;
  if (sendWindow && !sendWindow.ok) return apiValidationError({ send_window: [sendWindow.error] });

  const db = await scopedClient(auth);

  const { data: existing } = await db.from("email_sequences").select("id").eq("id", id).maybeSingle();
  if (!existing) return apiNotFound("Sequence");

  const updates: Record<string, unknown> = {};
  if (body.name !== undefined) updates.name = String(body.name).trim();
  if (body.description !== undefined) updates.description = body.description ? String(body.description) : null;
  if (body.auto_send !== undefined) updates.auto_send = body.auto_send === true;
  if (body.on_reply !== undefined) updates.on_reply = body.on_reply as OnReply;
  // Takes effect for drafts created from now on; drafts already created keep the due time they have.
  if (sendWindow && sendWindow.ok) updates.send_window = sendWindow.window;

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

    const { data: existingSteps } = await db
      .from("email_sequence_steps")
      .select("step_order, delay_days, draft_source, send_time")
      .eq("sequence_id", id)
      .order("step_order", { ascending: true });
    const existing = (existingSteps ?? []) as unknown as Array<{ step_order: number; delay_days: number; draft_source: string; send_time: string | null }>;

    // Steps leads have already reached keep their order, wait and kind; their wording and everything after them can change.
    const lock = await loadStepLock(db, id, existing.length);
    const check = checkStepEdit(existing, body.steps as SequenceStepInput[], lock.lockedUpTo);
    if (!check.ok) return apiConflict(check.message);

    // Apply the new step list in ONE database transaction (apply_sequence_steps, migration 265): it takes a lock on the
    // sequence, re-checks which steps leads have reached, then adds the new steps, updates the ones that stay and
    // removes the ones that went — never an empty table in between. Doing the lock check and the write as separate
    // calls left a window where a lead could advance to a step that was just being changed; the transaction closes it,
    // and a draft built from an older version of the steps is refused and rebuilt (see engine.ts).
    const incoming = (body.steps as SequenceStepInput[]).map((s) => ({
      step_order: s.step_order,
      delay_days: s.delay_days ?? 0,
      send_time: s.send_time || null,
      subject_template: s.subject_template ?? "",
      body_template: s.body_template ?? "",
      draft_source: s.draft_source ?? "template",
      ai_instructions: s.ai_instructions ?? null,
    }));
    const { error: applyError } = await db.rpc("apply_sequence_steps", { p_sequence_id: id, p_steps: incoming });
    if (applyError) {
      // the authoritative lock check inside the transaction (our read above may be a moment stale)
      if (applyError.message?.includes("STEPS_LOCKED")) return apiConflict(stepsLockedMessage(Number(applyError.hint) || 0));
      log.error({ error: applyError }, "Failed to apply sequence steps");
      return apiError("DB_ERROR", "Failed to update sequence steps", 500);
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
