/**
 * Pure, deterministic project health + progress computations (Phase 1 —
 * no AI). Shared by API routes and UI so the two never disagree.
 */

export type ProjectHealth = "green" | "amber" | "red";

interface ComputeProjectHealthInput {
  healthOverride: ProjectHealth | null;
  actualMinutes: number;
  currentEstimateMinutes: number | null;
  targetEndDate: string | null; // ISO date (YYYY-MM-DD)
  pctComplete: number; // 0-100
  today?: Date;
}

/**
 * red   if actual > 110% of current estimate, OR past target end date and incomplete
 * amber if actual > 90% of current estimate
 * green otherwise
 * A manual `health_override` always wins.
 */
export function computeProjectHealth(input: ComputeProjectHealthInput): ProjectHealth {
  if (input.healthOverride) return input.healthOverride;

  const estimate = input.currentEstimateMinutes ?? 0;
  const overBudget = estimate > 0 && input.actualMinutes > 1.1 * estimate;

  const today = input.today ?? new Date();
  const pastDueIncomplete =
    !!input.targetEndDate && new Date(input.targetEndDate) < today && input.pctComplete < 100;

  if (overBudget || pastDueIncomplete) return "red";

  const nearBudget = estimate > 0 && input.actualMinutes > 0.9 * estimate;
  if (nearBudget) return "amber";

  return "green";
}

interface TaskForPctComplete {
  status: string;
  estimatedMinutes: number | null;
}

/**
 * Estimate-weighted % complete: Σ estimated_minutes(status=done) ÷ Σ estimated_minutes.
 * Falls back to count(done) ÷ count(*) when no task carries an estimate.
 */
export function computePctComplete(tasks: TaskForPctComplete[]): number {
  if (tasks.length === 0) return 0;

  const totalEstimate = tasks.reduce((sum, t) => sum + (t.estimatedMinutes ?? 0), 0);
  if (totalEstimate > 0) {
    const doneEstimate = tasks
      .filter((t) => t.status === "done")
      .reduce((sum, t) => sum + (t.estimatedMinutes ?? 0), 0);
    return Math.round((doneEstimate / totalEstimate) * 100);
  }

  const doneCount = tasks.filter((t) => t.status === "done").length;
  return Math.round((doneCount / tasks.length) * 100);
}
