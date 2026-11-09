/**
 * The inline call log's save, as a plan: an ORDERED list of requests against the EXISTING endpoints
 * (no new write endpoint). The order matters:
 *
 *   1. POST /leads/:id/activities   the call itself
 *   2. POST /leads/:id/notes        optional note
 *   3. PATCH /leads/:id             call-back time and/or next stage
 *
 * Why: the touch-signals trigger (migration 250) fires on INSERT into lead_activities AND lead_notes and, on every
 * insert, either overwrites `leads.callback_due_at` (no answer / busy → now + 10 min) or clears it. A call-back time
 * the person picked is therefore only durable if it is written AFTER every activity/note insert. A plain UPDATE of
 * `leads` (the PATCH) does not fire that trigger, so the value sticks.
 */
export type CallOutcomeChoice = "talked" | "no_answer" | "busy" | "wrong_number" | "not_interested";

export const OUTCOME_LABEL: Record<CallOutcomeChoice, string> = {
  talked: "Talked",
  no_answer: "No answer",
  busy: "Busy, call later",
  wrong_number: "Wrong number",
  not_interested: "Not interested",
};

/** The API's call_outcome enum has no "not interested": it is a connected call, said so in the subject. */
const API_OUTCOME: Record<CallOutcomeChoice, "connected" | "no_answer" | "busy" | "wrong_number"> = {
  talked: "connected",
  no_answer: "no_answer",
  busy: "busy",
  wrong_number: "wrong_number",
  not_interested: "connected",
};

/** The fields the person ticked from Orca's suggestions (B1). Sent through /home/note-save so the edit is stamped ai_suggested. */
export interface AiNoteSave {
  draftId: string | null;
  fields: Array<{ field: string; to: string }>;
}

export interface CallLogInput {
  leadId: string;
  outcome: CallOutcomeChoice;
  /** ISO timestamp from the picker, or null. */
  callbackAt: string | null;
  /** Destination list id for "Move to next stage", or null. */
  nextListId: string | null;
  note: string;
  /** Present only when AI is on and the person ticked at least one suggested field. */
  ai?: AiNoteSave;
}

export interface PlannedRequest {
  step: "activity" | "note" | "lead";
  method: "POST" | "PATCH";
  url: string;
  body: Record<string, unknown>;
}

export function planCallLogSave(i: CallLogInput): PlannedRequest[] {
  const plan: PlannedRequest[] = [
    {
      step: "activity",
      method: "POST",
      url: `/api/v1/leads/${i.leadId}/activities`,
      body: {
        activity_type: "call",
        call_outcome: API_OUTCOME[i.outcome],
        subject: i.outcome === "not_interested" ? "Call: not interested" : "Call",
      },
    },
  ];
  const note = i.note.trim();
  if (note) {
    plan.push({ step: "note", method: "POST", url: `/api/v1/leads/${i.leadId}/notes`, body: { content: note } });
  }
  if (i.ai && i.ai.fields.length > 0) {
    // One request carries the ticked fields, the call-back and the stage move; still AFTER the activity + note inserts.
    plan.push({
      step: "lead",
      method: "POST",
      url: "/api/v1/home/note-save",
      body: { leadId: i.leadId, draftId: i.ai.draftId, fields: i.ai.fields, callbackAt: i.callbackAt, nextListId: i.nextListId },
    });
    return plan;
  }
  const patch: Record<string, unknown> = {};
  if (i.callbackAt) patch.callback_due_at = i.callbackAt;
  if (i.nextListId) patch.list_id = i.nextListId;
  if (Object.keys(patch).length > 0) {
    plan.push({ step: "lead", method: "PATCH", url: `/api/v1/leads/${i.leadId}`, body: patch });
  }
  return plan;
}

export type Fetcher = (req: PlannedRequest) => Promise<{ ok: boolean; message?: string }>;

/** Runs the plan strictly in order and stops at the first failure, reporting which step failed. */
export async function runPlan(plan: PlannedRequest[], send: Fetcher): Promise<{ ok: true } | { ok: false; failed: PlannedRequest["step"]; message: string; done: PlannedRequest["step"][] }> {
  const done: PlannedRequest["step"][] = [];
  for (const req of plan) {
    const r = await send(req);
    if (!r.ok) return { ok: false, failed: req.step, message: r.message ?? "Something went wrong", done };
    done.push(req.step);
  }
  return { ok: true };
}
