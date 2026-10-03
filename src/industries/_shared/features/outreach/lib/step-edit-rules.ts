import type { SequenceStepInput } from "./validate-steps";

// Editing the STRUCTURE (order, number of steps, the wait, AI vs template) of a sequence that leads are already running.
//
// Until now any structural change was refused while a single lead was active or paused — after a bulk enroll that meant a
// sequence was frozen for weeks. But a lead only depends on the steps it has REACHED: its next draft is created from the
// step table at the moment it advances, so a change to a step it has not reached yet is safe. A lead that has handled
// step N has a draft for step N+1 already created (with that step's wait baked into its due time), so steps 1..N+1 are
// "in use". Those keep their order, wait and kind (their TEXT can always be edited, as before); everything after them
// can be added, removed, reordered or retimed freely.

export interface ExistingStep {
  step_order: number;
  delay_days: number;
  send_time?: string | null;
  draft_source: string;
}

/**
 * The highest step number in use by a running (active / paused) enrollment: its furthest lead has handled
 * `maxCurrentStepOrder` steps, so that step's successor already has a draft. Capped at the last step that exists. 0 means
 * no lead is running, nothing is locked.
 */
export function lockedUpToStep(maxCurrentStepOrder: number | null, existingStepCount: number): number {
  if (maxCurrentStepOrder === null) return 0;
  return Math.min(maxCurrentStepOrder + 1, existingStepCount);
}

export type StepEditCheck = { ok: true } | { ok: false; message: string };

/** Is `incoming` an allowed edit of `existing` given that steps 1..lockedUpTo are in use? */
export function checkStepEdit(existing: ExistingStep[], incoming: SequenceStepInput[], lockedUpTo: number): StepEditCheck {
  if (lockedUpTo <= 0) return { ok: true };

  const byOrder = new Map(incoming.map((s) => [s.step_order, s]));
  for (const step of existing) {
    if (step.step_order > lockedUpTo) continue;
    const next = byOrder.get(step.step_order);
    const same =
      !!next && (next.delay_days ?? 0) === step.delay_days &&
      (next.draft_source ?? "template") === step.draft_source &&
      (next.send_time || null) === (step.send_time || null);
    if (!same) {
      return {
        ok: false,
        message:
          `Steps 1–${lockedUpTo} are already in use by leads in this sequence, so their order, wait, send time and drafting can't change. ` +
          `You can still edit their wording, and change anything from step ${lockedUpTo + 1} on.`,
      };
    }
  }
  return { ok: true };
}
