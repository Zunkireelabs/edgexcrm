import { createServiceClient } from "@/lib/supabase/server";
import { logger } from "@/lib/logger";

// The in-process background timers (src/instrumentation.ts) — one place that starts them and records a HEARTBEAT after
// every pass, so a timer that stops or wedges shows up on GET /api/health/runners instead of failing silently
// (migration 261). Heartbeat = "a pass FINISHED" (success or error); a pass that hangs inside an await never finishes,
// so its heartbeat goes stale — exactly the failure we want to see.
//
// Not Inngest: its shared execution quota was exhausted once and silently blocked every blast. These run in the one
// long-lived Node process per environment; DB row state is what matters, so a restart only delays work.

/** Every registered runner and how often it ticks. The health route reads this same list. */
export const RUNNERS = {
  "email-blast": { intervalMs: 30_000 },
  "sequence-schedule": { intervalMs: 60_000 },
  "bulk-enroll": { intervalMs: 30_000 },
  "sequence-autosend": { intervalMs: 60_000 },
} as const;

export type RunnerName = keyof typeof RUNNERS;

const MIN_STALE_MS = 5 * 60_000;

/** A runner is stale when no pass has finished for this long: 5 minutes, or 5 intervals if that is longer. */
export function staleAfterMs(intervalMs: number): number {
  return Math.max(MIN_STALE_MS, intervalMs * 5);
}

export interface PassOutcome {
  startedAt: Date;
  finishedAt: Date;
  error: string | null;
}

/** Writes the heartbeat row. Never throws — losing a heartbeat must not break the pass that just finished. */
export async function recordRunnerPass(name: RunnerName, outcome: PassOutcome): Promise<void> {
  try {
    const supabase = await createServiceClient();
    const ok = outcome.error === null;
    const { error } = await supabase.from("runner_heartbeats").upsert(
      {
        name,
        last_started_at: outcome.startedAt.toISOString(),
        last_finished_at: outcome.finishedAt.toISOString(),
        // last_ok_at only moves on success; the error fields are cleared by a success
        ...(ok ? { last_ok_at: outcome.finishedAt.toISOString(), last_error: null, last_error_at: null } : { last_error: outcome.error!.slice(0, 300), last_error_at: outcome.finishedAt.toISOString() }),
        updated_at: outcome.finishedAt.toISOString(),
      },
      { onConflict: "name" }
    );
    if (error) logger.warn({ err: error, runner: name }, "runner-timer: failed to record heartbeat");
  } catch (err) {
    logger.warn({ err, runner: name }, "runner-timer: failed to record heartbeat");
  }
}

/** One tick: run the pass, then record how it went. Exported so it can be tested without real timers. */
export async function runTick(name: RunnerName, run: () => Promise<unknown>): Promise<void> {
  const startedAt = new Date();
  let error: string | null = null;
  try {
    await run();
  } catch (err) {
    error = err instanceof Error ? err.message : String(err);
    logger.error({ err, runner: name }, `[${name}] periodic pass threw`);
  }
  await recordRunnerPass(name, { startedAt, finishedAt: new Date(), error });
}

// Dev hot reload runs register() more than once in the same process; without this a reload would stack a second timer
// on top of the first (and double every pass). globalThis survives module reloads, a module-level flag does not.
const g = globalThis as unknown as { __edgexRunnerTimers?: Set<string> };

export function startRunnerTimer(name: RunnerName, run: () => Promise<unknown>): boolean {
  const started = (g.__edgexRunnerTimers ??= new Set<string>());
  if (started.has(name)) return false;
  started.add(name);
  setInterval(() => {
    void runTick(name, run);
  }, RUNNERS[name].intervalMs);
  return true;
}
