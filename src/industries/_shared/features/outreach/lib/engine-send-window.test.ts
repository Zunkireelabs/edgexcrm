import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// createDraftForStep (via enrollLead) with a SEND WINDOW (Phase 3): the draft's due_at comes from the sequence's
// window — time of day, allowed days, the lead's (or office's) timezone — not just "now + wait". A sequence without a
// window keeps the old rule exactly; a stored window that no longer validates is ignored rather than blocking.

vi.mock("@/lib/api/audit", () => ({ emitEvent: vi.fn().mockResolvedValue(null) }));
vi.mock("@/lib/ai/flag", () => ({ isOutreachDraftEnabledForTenant: vi.fn().mockResolvedValue(false) }));
vi.mock("@/lib/ai/draft-email", () => ({ draftSequenceEmail: vi.fn() }));
vi.mock("@/lib/logger", () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } }));

import { enrollLead } from "./engine";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = Record<string, any>;

let tables: Record<string, Row[]>;

function makeDb() {
  const table = (name: string) => {
    const rows = tables[name] ?? (tables[name] = []);
    return {
      select: (_cols?: string, opts?: { head?: boolean }) => {
        const eqs: Array<[string, unknown]> = [];
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const b: any = {
          eq(c: string, v: unknown) {
            eqs.push([c, v]);
            return b;
          },
          maybeSingle: async () => ({ data: rows.find((r) => eqs.every(([c, v]) => r[c] === v)) ?? null, error: null }),
          then(resolve: (v: unknown) => void) {
            const hit = rows.filter((r) => eqs.every(([c, v]) => r[c] === v));
            resolve(opts?.head ? { count: hit.length, data: null, error: null } : { data: hit, error: null });
          },
        };
        return b;
      },
      insert: (payload: Row) => {
        const row = { id: `${name}-${rows.length + 1}`, ...payload };
        rows.push(row);
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const b: any = { select: () => b, single: async () => ({ data: row, error: null }) };
        return b;
      },
    };
  };
  return { from: table, fromGlobal: table };
}

function seed(opts: { window?: unknown; delay?: number; country?: string | null; tenantTz?: string | null }) {
  tables = {
    email_sequence_steps: [
      { id: "step-1", tenant_id: "t1", sequence_id: "seq-1", step_order: 1, delay_days: opts.delay ?? 0, channel: "email", draft_source: "template", subject_template: "Hello {{first_name}}", body_template: "<p>Hi</p>", ai_instructions: null },
    ],
    email_sequences: [{ id: "seq-1", name: "Welcome", description: null, send_window: opts.window ?? null }],
    leads: [{ id: "lead-1", first_name: "Sita", last_name: "Rai", email: "s@x.com", phone: null, city: null, country: opts.country ?? null, custom_fields: null }],
    tenants: [{ id: "t1", name: "Admizz", timezone: opts.tenantTz === undefined ? "Asia/Kathmandu" : opts.tenantTz }],
    sequence_enrollments: [],
    sequence_step_drafts: [],
  };
}

const AUTH = { tenantId: "t1", userId: "u1" } as never;
const run = () => enrollLead(makeDb() as never, AUTH, { sequenceId: "seq-1", leadId: "lead-1", assignedTo: "u1", enrolledBy: "u1" });
const dueAt = () => tables.sequence_step_drafts[0].due_at as string;

const weekdays10 = { time: "10:00", days: [1, 2, 3, 4, 5], timezone_mode: "office", spread_minutes: 0 };

beforeEach(() => {
  vi.useFakeTimers();
});
afterEach(() => {
  vi.useRealTimers();
});

describe("createDraftForStep due_at", () => {
  it("no window: exactly now + the step's wait (the old behaviour)", async () => {
    vi.setSystemTime(new Date("2026-10-03T22:30:00Z")); // a Saturday night
    seed({ window: null, delay: 2 });
    await run();
    expect(dueAt()).toBe("2026-10-05T22:30:00.000Z");
  });

  it("with a window, Step 1 waits for it: Saturday night -> Monday 10:00 in the office's timezone", async () => {
    vi.setSystemTime(new Date("2026-10-03T22:30:00Z"));
    seed({ window: weekdays10, delay: 0, country: null });
    await run();
    expect(dueAt()).toBe("2026-10-05T04:15:00.000Z"); // Mon 10:00 Kathmandu (UTC+5:45)
  });

  it("lead mode uses the lead's country zone; an unknown country falls back to the office zone", async () => {
    vi.setSystemTime(new Date("2026-10-07T03:00:00Z")); // Wed
    seed({ window: { ...weekdays10, timezone_mode: "lead" }, country: "Australia" });
    await run();
    // Wed 03:00 UTC = Wed 14:00 in Sydney (UTC+11) -> today's 10:00 window is over -> Thu 10:00 Sydney = Wed 23:00 UTC
    expect(dueAt()).toBe("2026-10-07T23:00:00.000Z");

    seed({ window: { ...weekdays10, timezone_mode: "lead" }, country: "Narnia" });
    await run();
    expect(dueAt()).toBe("2026-10-07T04:15:00.000Z"); // office zone: Wed 10:00 Kathmandu is still ahead
  });

  it("office mode ignores the lead's country", async () => {
    vi.setSystemTime(new Date("2026-10-07T03:00:00Z"));
    seed({ window: weekdays10, country: "Australia" });
    await run();
    expect(dueAt()).toBe("2026-10-07T04:15:00.000Z");
  });

  it("the spread is applied and is stable for the same lead and step", async () => {
    vi.setSystemTime(new Date("2026-10-07T03:00:00Z"));
    seed({ window: { ...weekdays10, spread_minutes: 120 } });
    await run();
    const first = new Date(dueAt()).getTime();
    const start = new Date("2026-10-07T04:15:00Z").getTime();
    expect(first - start).toBeGreaterThanOrEqual(0);
    expect(first - start).toBeLessThan(120 * 60_000);

    seed({ window: { ...weekdays10, spread_minutes: 120 } });
    await run();
    expect(new Date(dueAt()).getTime()).toBe(first); // same lead + step -> same minute
  });

  it("a stored window that no longer validates is ignored (old rule) instead of blocking the enrollment", async () => {
    vi.setSystemTime(new Date("2026-10-03T22:30:00Z"));
    seed({ window: { time: "25:99", days: [], timezone_mode: "nowhere", spread_minutes: -5 }, delay: 1 });
    await run();
    expect(dueAt()).toBe("2026-10-04T22:30:00.000Z");
  });

  it("a missing tenant timezone falls back to UTC", async () => {
    vi.setSystemTime(new Date("2026-10-07T03:00:00Z"));
    seed({ window: weekdays10, tenantTz: null });
    await run();
    expect(dueAt()).toBe("2026-10-07T10:00:00.000Z");
  });
});
