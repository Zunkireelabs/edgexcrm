import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Runner heartbeats (migration 261): every pass records how it ended; a timer is registered once per process; the
// staleness rule is 5 minutes or 5 intervals. The health route reads the same registry.

const upserts: Array<{ row: Record<string, unknown>; opts: unknown }> = [];
let upsertError: { message: string } | null = null;
let throwOnClient = false;

vi.mock("@/lib/supabase/server", () => ({
  createServiceClient: async () => {
    if (throwOnClient) throw new Error("no database");
    return {
      from: (table: string) => ({
        upsert: async (row: Record<string, unknown>, opts: unknown) => {
          upserts.push({ row: { table, ...row }, opts });
          return { error: upsertError };
        },
      }),
    };
  },
}));
vi.mock("@/lib/logger", () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } }));

import { RUNNERS, recordRunnerPass, runTick, startRunnerTimer, staleAfterMs } from "./runner-timer";

beforeEach(() => {
  upserts.length = 0;
  upsertError = null;
  throwOnClient = false;
  (globalThis as unknown as { __edgexRunnerTimers?: Set<string> }).__edgexRunnerTimers = undefined;
});
afterEach(() => {
  vi.useRealTimers();
});

describe("staleAfterMs", () => {
  it("is 5 minutes for the 30 s and 60 s runners, and never less than 5 intervals", () => {
    expect(staleAfterMs(30_000)).toBe(300_000);
    expect(staleAfterMs(60_000)).toBe(300_000);
    expect(staleAfterMs(120_000)).toBe(600_000);
  });
  it("every registered runner has an interval", () => {
    expect(Object.keys(RUNNERS).sort()).toEqual(["bulk-enroll", "email-blast", "sequence-autosend", "sequence-schedule"]);
  });
});

describe("runTick / recordRunnerPass", () => {
  it("a successful pass records start, finish and last_ok, clearing any earlier error", async () => {
    await runTick("bulk-enroll", async () => undefined);

    expect(upserts).toHaveLength(1);
    expect(upserts[0].opts).toEqual({ onConflict: "name" });
    expect(upserts[0].row).toMatchObject({ table: "runner_heartbeats", name: "bulk-enroll", last_error: null, last_error_at: null });
    expect(upserts[0].row.last_ok_at).toEqual(expect.any(String));
    expect(upserts[0].row.last_finished_at).toEqual(expect.any(String));
  });

  it("a pass that throws still records a heartbeat — with the error, and WITHOUT touching last_ok_at", async () => {
    await runTick("email-blast", async () => {
      throw new Error("provider down");
    });

    expect(upserts[0].row).toMatchObject({ name: "email-blast", last_error: "provider down" });
    expect(upserts[0].row.last_error_at).toEqual(expect.any(String));
    expect(upserts[0].row).not.toHaveProperty("last_ok_at");
  });

  it("truncates a very long error", async () => {
    await runTick("email-blast", async () => {
      throw new Error("x".repeat(1000));
    });
    expect((upserts[0].row.last_error as string).length).toBe(300);
  });

  it("never throws when the heartbeat cannot be written (database error or no client)", async () => {
    upsertError = { message: "down" };
    await expect(runTick("bulk-enroll", async () => undefined)).resolves.toBeUndefined();
    throwOnClient = true;
    await expect(recordRunnerPass("bulk-enroll", { startedAt: new Date(), finishedAt: new Date(), error: null })).resolves.toBeUndefined();
  });
});

describe("startRunnerTimer", () => {
  it("starts a runner once per process, runs it on its interval, and records each pass", async () => {
    vi.useFakeTimers();
    const run = vi.fn().mockResolvedValue(undefined);

    expect(startRunnerTimer("bulk-enroll", run)).toBe(true);
    expect(startRunnerTimer("bulk-enroll", run)).toBe(false); // a hot reload must not stack a second timer

    await vi.advanceTimersByTimeAsync(RUNNERS["bulk-enroll"].intervalMs * 3);
    expect(run).toHaveBeenCalledTimes(3);
    expect(upserts).toHaveLength(3);
  });

  it("different runners are independent", () => {
    vi.useFakeTimers();
    expect(startRunnerTimer("bulk-enroll", async () => undefined)).toBe(true);
    expect(startRunnerTimer("email-blast", async () => undefined)).toBe(true);
  });
});
