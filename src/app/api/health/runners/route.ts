import { NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { logger } from "@/lib/logger";
import { RUNNERS, staleAfterMs, type RunnerName } from "@/lib/ops/runner-timer";

// GET /api/health/runners — are the in-process background timers alive? (blasts, scheduled sends, bulk enroll,
// auto-send.) 200 {"status":"ok"} when every runner has finished a pass recently, 503 {"status":"stale"} when one has not
// (or the heartbeat table cannot be read). Point an external monitor at it (docs/reference/04-PROD-RESILIENCE.md):
// a stopped timer means scheduled emails silently never go out.
//
// Public on purpose (a monitor has no session) and low-information: runner names and ages only, never error text.
// A runner is judged from max(its last finished pass, this process's start time), so a fresh restart gets a grace
// period instead of looking stale until the first tick.

export const dynamic = "force-dynamic";

interface HeartbeatRow {
  name: string;
  last_finished_at: string | null;
  last_error_at: string | null;
  last_ok_at: string | null;
}

export async function GET() {
  const now = Date.now();
  const processStartedAt = now - process.uptime() * 1000;

  let rows: HeartbeatRow[];
  try {
    const supabase = await createServiceClient();
    const { data, error } = await supabase.from("runner_heartbeats").select("name, last_finished_at, last_error_at, last_ok_at");
    if (error) throw error;
    rows = (data ?? []) as HeartbeatRow[];
  } catch (err) {
    logger.error({ err }, "health/runners: cannot read runner_heartbeats");
    return NextResponse.json({ status: "error" }, { status: 503 });
  }
  const byName = new Map(rows.map((r) => [r.name, r]));

  const runners = (Object.keys(RUNNERS) as RunnerName[]).map((name) => {
    const row = byName.get(name);
    const lastFinished = row?.last_finished_at ? Date.parse(row.last_finished_at) : 0;
    const effectiveLast = Math.max(lastFinished, processStartedAt);
    const ageMs = now - effectiveLast;
    const stale = ageMs > staleAfterMs(RUNNERS[name].intervalMs);
    // the last pass failed more recently than it succeeded (informational — only staleness flips the status)
    const failing = !!row?.last_error_at && (!row.last_ok_at || Date.parse(row.last_error_at) > Date.parse(row.last_ok_at));
    return { name, age_seconds: Math.round(ageMs / 1000), stale, failing };
  });

  const status = runners.some((r) => r.stale) ? "stale" : "ok";
  return NextResponse.json({ status, runners }, { status: status === "ok" ? 200 : 503 });
}
