export interface SequenceStepInput {
  step_order: number;
  delay_days?: number;
  subject_template?: string;
  body_template?: string;
}

/** Shared shape check for sequence step arrays on both create (POST) and edit (PATCH). */
export function validateSequenceSteps(steps: unknown): string | null {
  if (!Array.isArray(steps) || steps.length === 0) return "steps must be a non-empty array";
  const orders = new Set<number>();
  for (const s of steps as SequenceStepInput[]) {
    if (typeof s.step_order !== "number" || !Number.isInteger(s.step_order) || s.step_order < 1) {
      return "each step needs a positive integer step_order";
    }
    if (orders.has(s.step_order)) return "step_order must be unique per sequence";
    orders.add(s.step_order);
    if (
      s.delay_days !== undefined &&
      (typeof s.delay_days !== "number" || !Number.isInteger(s.delay_days) || s.delay_days < 0)
    ) {
      return "delay_days must be a non-negative integer";
    }
  }
  if (!orders.has(1)) return "steps must start at step_order 1";
  return null;
}
