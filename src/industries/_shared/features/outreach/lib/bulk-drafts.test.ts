import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Bulk draft actions (Phase 6): body parsing, which drafts are eligible (through the shared scope), and the scheduling
// write. The scope itself is covered in draft-scope.test.ts; here it is stubbed with an in-memory table.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = Record<string, any>;
let rows: Row[];
let scopeCalls: Array<{ filters: Record<string, unknown>; select: string; opts: unknown }>;

vi.mock("./draft-scope", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./draft-scope")>();
  return {
    ...actual,
    buildDraftsQuery: (_db: unknown, _auth: unknown, filters: Record<string, unknown>, select: string, opts: unknown) => {
      scopeCalls.push({ filters, select, opts });
      let inIds: string[] | null = null;
      let from = 0;
      let to = Infinity;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const b: any = {
        in(_c: string, ids: string[]) { inIds = ids; return b; },
        order() { return b; },
        range(f: number, t: number) { from = f; to = t; return b; },
        then(resolve: (v: unknown) => void) {
          const hit = rows.filter((r) => !inIds || inIds.includes(r.id));
          if ((opts as { head?: boolean } | undefined)?.head) resolve({ count: hit.length, data: null, error: null });
          else resolve({ data: hit.slice(from, to + 1), error: null });
        },
      };
      return b;
    },
  };
});

import { BULK_DRAFT_MAX, parseBulkDraftBody, resolveEligibleDrafts, scheduleDrafts } from "./bulk-drafts";

const U = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const draftRow = (n: number, over: Row = {}): Row => ({ id: U(n), subject: `Subject ${n}`, leads: { email: `l${n}@example.com` }, ...over });

beforeEach(() => {
  rows = [];
  scopeCalls = [];
  vi.useFakeTimers();
  vi.setSystemTime(new Date("2026-10-05T04:00:00Z"));
});
afterEach(() => vi.useRealTimers());

describe("parseBulkDraftBody", () => {
  const ids = { mode: "ids", ids: [U(1), U(2), U(1)] };

  it("accepts send / skip with ids (de-duplicated) or with 'all matching'", () => {
    const a = parseBulkDraftBody({ action: "send", selection: ids });
    expect(a.ok && a.value.selection).toEqual({ mode: "ids", ids: [U(1), U(2)] });
    const b = parseBulkDraftBody({ action: "skip", selection: { mode: "all", due: "today" }, confirm: true });
    expect(b.ok && b.value).toMatchObject({ action: "skip", confirm: true, selection: { mode: "all", due: "today", assignedTo: null } });
  });

  it("'all' with anything but due=today means all pending; an assignee must be a real uuid", () => {
    const a = parseBulkDraftBody({ action: "send", selection: { mode: "all", due: "whenever", assigned_to: "x' or 1=1" } });
    expect(a.ok && a.value.selection).toEqual({ mode: "all", due: "all", assignedTo: null });
    const b = parseBulkDraftBody({ action: "send", selection: { mode: "all", due: "all", assigned_to: U(7) } });
    expect(b.ok && b.value.selection).toMatchObject({ assignedTo: U(7) });
  });

  it("rejects an unknown action, no / bad / too many ids, and an unknown mode", () => {
    expect(parseBulkDraftBody({ action: "delete", selection: ids }).ok).toBe(false);
    expect(parseBulkDraftBody({ action: "send", selection: { mode: "ids", ids: [] } }).ok).toBe(false);
    expect(parseBulkDraftBody({ action: "send", selection: { mode: "ids", ids: ["nope"] } }).ok).toBe(false);
    expect(parseBulkDraftBody({ action: "send", selection: { mode: "ids", ids: Array.from({ length: BULK_DRAFT_MAX + 1 }, (_, i) => U(i + 1)) } }).ok).toBe(false);
    expect(parseBulkDraftBody({ action: "send", selection: { mode: "everyone" } }).ok).toBe(false);
    expect(parseBulkDraftBody({ action: "send" }).ok).toBe(false);
  });

  it("schedule needs a time 5 minutes to 90 days ahead", () => {
    const at = (ms: number) => new Date(Date.now() + ms).toISOString();
    expect(parseBulkDraftBody({ action: "schedule", selection: ids, send_at: at(10 * 60_000) }).ok).toBe(true);
    const soon = parseBulkDraftBody({ action: "schedule", selection: ids, send_at: at(60_000) });
    expect(!soon.ok && soon.code).toBe("SCHEDULE_TOO_SOON");
    const far = parseBulkDraftBody({ action: "schedule", selection: ids, send_at: at(91 * 24 * 3600_000) });
    expect(!far.ok && far.code).toBe("SCHEDULE_TOO_FAR");
    expect(parseBulkDraftBody({ action: "schedule", selection: ids }).ok).toBe(false);
    expect(parseBulkDraftBody({ action: "schedule", selection: ids, send_at: "not a date" }).ok).toBe(false);
  });
});

describe("resolveEligibleDrafts", () => {
  it("ids: only the drafts the scope returns; the rest are 'not available' (not theirs, no longer pending, lead deleted …)", async () => {
    rows = [draftRow(1), draftRow(2)];
    const r = await resolveEligibleDrafts({} as never, {} as never, { mode: "ids", ids: [U(1), U(2), U(3), U(4)] }, { forSending: true, limit: 5000 });
    expect(r.eligible.map((d) => d.id)).toEqual([U(1), U(2)]);
    expect(r.notAvailable).toBe(2);
  });

  it("sending leaves out a draft with no subject or a lead with no email, and counts them", async () => {
    rows = [draftRow(1), draftRow(2, { subject: "  " }), draftRow(3, { leads: { email: null } }), draftRow(4, { leads: { email: " " } })];
    const r = await resolveEligibleDrafts({} as never, {} as never, { mode: "ids", ids: [U(1), U(2), U(3), U(4)] }, { forSending: true, limit: 5000 });
    expect(r.eligible.map((d) => d.id)).toEqual([U(1)]);
    expect(r.skipped).toEqual({ noSubject: 1, noEmail: 2 });
  });

  it("skipping does NOT care about subject or email", async () => {
    rows = [draftRow(1, { subject: "" }), draftRow(2, { leads: { email: null } })];
    const r = await resolveEligibleDrafts({} as never, {} as never, { mode: "ids", ids: [U(1), U(2)] }, { forSending: false, limit: 50 });
    expect(r.eligible).toHaveLength(2);
    expect(r.skipped).toEqual({ noSubject: 0, noEmail: 0 });
  });

  it("'all' counts first, pages through the matches, and uses the same scope filters as the list", async () => {
    rows = Array.from({ length: 2500 }, (_, i) => draftRow(i + 1));
    const r = await resolveEligibleDrafts({} as never, {} as never, { mode: "all", due: "today", assignedTo: U(9) }, { forSending: true, limit: 5000 });
    expect(r.matched).toBe(2500);
    expect(r.eligible).toHaveLength(2500);
    expect(new Set(r.eligible.map((d) => d.id)).size).toBe(2500); // no duplicates across pages
    expect(scopeCalls.every((c) => c.filters.due === "today" && c.filters.assignedTo === U(9))).toBe(true);
    expect(scopeCalls[0].opts).toEqual({ count: "exact", head: true });
  });

  it("never returns more than the limit and says so", async () => {
    rows = Array.from({ length: 120 }, (_, i) => draftRow(i + 1));
    const r = await resolveEligibleDrafts({} as never, {} as never, { mode: "all", due: "all", assignedTo: null }, { forSending: false, limit: 50 });
    expect(r.matched).toBe(120);
    expect(r.eligible).toHaveLength(50);
    expect(r.truncated).toBe(true);
  });

  it("an empty selection matches nothing", async () => {
    const r = await resolveEligibleDrafts({} as never, {} as never, { mode: "all", due: "all", assignedTo: null }, { forSending: true, limit: 5000 });
    expect(r).toMatchObject({ matched: 0, eligible: [], truncated: false });
  });
});

describe("scheduleDrafts", () => {
  it("sets the time, who scheduled it and clears an old error — only on PENDING drafts — in chunks", async () => {
    const calls: Array<{ patch: Row; ids: string[]; eqs: Array<[string, unknown]> }> = [];
    const db = {
      from: () => ({
        update: (patch: Row) => {
          const c = { patch, ids: [] as string[], eqs: [] as Array<[string, unknown]> };
          calls.push(c);
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const b: any = {
            in(_col: string, ids: string[]) { c.ids = ids; return b; },
            eq(col: string, v: unknown) { c.eqs.push([col, v]); return b; },
            select() { return b; },
            then(resolve: (v: unknown) => void) { resolve({ data: c.ids.map((id) => ({ id })), error: null }); },
          };
          return b;
        },
      }),
    } as never;
    const ids = Array.from({ length: 450 }, (_, i) => U(i + 1));
    const when = new Date("2026-10-06T09:00:00Z");

    const n = await scheduleDrafts(db, { userId: "u1" }, ids, when);

    expect(n).toBe(450);
    expect(calls.map((c) => c.ids.length)).toEqual([200, 200, 50]);
    expect(calls[0].patch).toEqual({ scheduled_send_at: "2026-10-06T09:00:00.000Z", scheduled_by: "u1", scheduled_error: null });
    expect(calls.every((c) => c.eqs.some(([col, v]) => col === "status" && v === "pending"))).toBe(true);
  });

  it("throws on a database error instead of reporting success", async () => {
    const db = { from: () => ({ update: () => { const b: any = { in: () => b, eq: () => b, select: () => b, then: (r: (v: unknown) => void) => r({ data: null, error: { message: "boom" } }) }; return b; } }) } as never; // eslint-disable-line @typescript-eslint/no-explicit-any
    await expect(scheduleDrafts(db, { userId: "u" }, [U(1)], new Date())).rejects.toThrow("bulk drafts: boom");
  });
});
