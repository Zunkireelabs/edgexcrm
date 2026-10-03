import { beforeEach, afterEach, describe, expect, it, vi } from "vitest";

// GET /api/health/runners — 200 only while every runner has finished a pass recently; a fresh restart gets a grace
// period; a stopped runner flips it to 503; an unreadable table is 503 too; error text is never exposed.

let rows: Record<string, unknown>[];
let selectError: { message: string } | null;

vi.mock("@/lib/supabase/server", () => ({
  createServiceClient: async () => ({ from: () => ({ select: async () => ({ data: rows, error: selectError }) }) }),
}));
vi.mock("@/lib/logger", () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } }));

import { GET } from "./route";

const NOW = new Date("2026-10-04T12:00:00Z").getTime();
const ago = (s: number) => new Date(NOW - s * 1000).toISOString();
const names = ["email-blast", "sequence-schedule", "bulk-enroll"];
const allFresh = () => names.map((name) => ({ name, last_finished_at: ago(20), last_ok_at: ago(20), last_error_at: null }));

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  vi.spyOn(process, "uptime").mockReturnValue(3600); // up for an hour
  rows = allFresh();
  selectError = null;
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

const body = async (res: Response) => (await res.json()) as { status: string; runners?: { name: string; stale: boolean; failing: boolean; age_seconds: number }[] };

describe("GET /api/health/runners", () => {
  it("200 and status ok when every runner finished a pass recently", async () => {
    const res = await GET();
    expect(res.status).toBe(200);
    const json = await body(res);
    expect(json.status).toBe("ok");
    expect(json.runners!.map((r) => r.name).sort()).toEqual([...names].sort());
    expect(JSON.stringify(json)).toContain('"status":"ok"'); // the keyword an external monitor looks for
  });

  it("503 and status stale as soon as one runner has not finished a pass for 5+ minutes", async () => {
    rows = allFresh().map((r) => (r.name === "sequence-schedule" ? { ...r, last_finished_at: ago(6 * 60) } : r));
    const res = await GET();
    expect(res.status).toBe(503);
    const json = await body(res);
    expect(json.status).toBe("stale");
    expect(json.runners!.find((r) => r.name === "sequence-schedule")).toMatchObject({ stale: true });
    expect(json.runners!.filter((r) => r.stale)).toHaveLength(1);
  });

  it("a runner with no heartbeat row at all is stale once the process has been up past the limit", async () => {
    rows = allFresh().filter((r) => r.name !== "bulk-enroll");
    expect((await GET()).status).toBe(503);
  });

  it("grace after a restart: no rows / old rows are fine while the process itself is only seconds old", async () => {
    vi.spyOn(process, "uptime").mockReturnValue(45);
    rows = [];
    expect((await GET()).status).toBe(200);
    rows = allFresh().map((r) => ({ ...r, last_finished_at: ago(3600) })); // heartbeats from before the restart
    expect((await GET()).status).toBe(200);
  });

  it("but a restart only buys the grace period: still no pass after 6 minutes up -> stale", async () => {
    vi.spyOn(process, "uptime").mockReturnValue(6 * 60);
    rows = [];
    expect((await GET()).status).toBe(503);
  });

  it("a runner whose last pass errored is flagged failing but only staleness flips the status", async () => {
    rows = allFresh().map((r) => (r.name === "email-blast" ? { ...r, last_error_at: ago(10), last_ok_at: ago(90) } : r));
    const res = await GET();
    expect(res.status).toBe(200);
    expect((await body(res)).runners!.find((r) => r.name === "email-blast")).toMatchObject({ failing: true, stale: false });
  });

  it("503 error when the heartbeat table cannot be read — and no error text leaks", async () => {
    selectError = { message: "relation runner_heartbeats does not exist: secret detail" };
    const res = await GET();
    expect(res.status).toBe(503);
    const text = JSON.stringify(await res.json());
    expect(text).toBe('{"status":"error"}');
  });
});
