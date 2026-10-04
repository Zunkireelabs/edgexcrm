import { beforeEach, describe, expect, it, vi } from "vitest";

// PATCH /api/v1/outreach/sequences/[id] — editing steps while leads are running (Outreach Phase 5):
// steps leads have reached keep their order / wait / kind (wording stays editable), later steps change freely.
// The write itself is ONE database call (apply_sequence_steps, migration 265 — it locks the sequence, re-checks the
// lock and rewrites the steps in a transaction); its behaviour is proven against a real database in
// outreach/lib/sequence-concurrency.db.test.ts. Here: the route hands over the right steps, refuses early with a
// plain message, and maps the database's own STEPS_LOCKED refusal. GET reports how far leads have got (locked_up_to).

const authMock = vi.fn();
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Row = Record<string, any>;
let tables: Record<string, Row[]>;
let ops: string[];
let rpcCalls: Array<{ fn: string; args: Row }>;
let rpcResult: { data: unknown; error: { message: string; hint?: string } | null };

vi.mock("@/lib/api/auth", () => ({
  authenticateRequest: () => authMock(),
  requireAdmin: (a: { role: string }) => a.role === "owner" || a.role === "admin",
}));
vi.mock("@/industries/_loader", () => ({ getFeatureAccess: () => true }));
vi.mock("@/lib/logger", () => ({ createRequestLogger: () => ({ info: vi.fn(), error: vi.fn(), warn: vi.fn() }) }));

vi.mock("@/lib/supabase/scoped", () => ({
  scopedClient: async () => ({
    rpc: async (fn: string, args: Row) => {
      rpcCalls.push({ fn, args });
      return rpcResult;
    },
    from(table: string) {
      const rows = (tables[table] ??= []);
      const filters = () => {
        const eqs: Array<[string, unknown]> = [];
        const ins: Array<[string, unknown[]]> = [];
        let orderCol: string | null = null;
        let desc = false;
        let limitN: number | null = null;
        return {
          eqs, ins,
          get matches() {
            return (r: Row) => eqs.every(([c, v]) => r[c] === v) && ins.every(([c, vs]) => vs.includes(r[c]));
          },
          set order([c, d]: [string, boolean]) { orderCol = c; desc = d; },
          get orderCol() { return orderCol; },
          get desc() { return desc; },
          set limit(n: number | null) { limitN = n; },
          get limitN() { return limitN; },
        };
      };
      const select = (_cols?: string, opts?: { head?: boolean }) => {
        const f = filters();
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const b: any = {
          eq(c: string, v: unknown) { f.eqs.push([c, v]); return b; },
          in(c: string, vs: unknown[]) { f.ins.push([c, vs]); return b; },
          order(c: string, o?: { ascending?: boolean; referencedTable?: string }) { if (!o?.referencedTable) f.order = [c, o?.ascending === false]; return b; },
          limit(n: number) { f.limit = n; return b; },
          maybeSingle: async () => ({ data: result()[0] ?? null, error: null }),
          then(resolve: (v: unknown) => void) {
            resolve(opts?.head ? { count: result().length, data: null, error: null } : { data: result(), error: null });
          },
        };
        function result() {
          let hit = rows.filter(f.matches);
          if (f.orderCol) hit = [...hit].sort((a, c) => (f.desc ? -1 : 1) * (a[f.orderCol!] - c[f.orderCol!]));
          if (f.limitN != null) hit = hit.slice(0, f.limitN);
          return hit.map((r) => (table === "email_sequences" ? { ...r, email_sequence_steps: (tables.email_sequence_steps ?? []).filter((x) => x.sequence_id === r.id) } : { ...r }));
        }
        return b;
      };
      return {
        select,
        insert: async (payload: Row | Row[]) => {
          const list = Array.isArray(payload) ? payload : [payload];
          list.forEach((p) => { ops.push(`insert:${table}:${p.step_order ?? ""}`); rows.push({ id: `${table}-${rows.length + 1}`, ...p }); });
          return { error: null };
        },
        update: (patch: Row) => {
          const f = filters();
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const b: any = {
            eq(c: string, v: unknown) { f.eqs.push([c, v]); return b; },
            then(resolve: (v: unknown) => void) {
              const hit = rows.filter(f.matches);
              hit.forEach((r) => { ops.push(`update:${table}:${r.step_order ?? r.id}`); Object.assign(r, patch); });
              resolve({ error: null });
            },
          };
          return b;
        },
        delete: () => {
          const f = filters();
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const b: any = {
            eq(c: string, v: unknown) { f.eqs.push([c, v]); return b; },
            in(c: string, vs: unknown[]) { f.ins.push([c, vs]); return b; },
            then(resolve: (v: unknown) => void) {
              const hit = rows.filter(f.matches);
              hit.forEach((r) => { ops.push(`delete:${table}:${r.step_order ?? r.id}`); rows.splice(rows.indexOf(r), 1); });
              resolve({ error: null });
            },
          };
          return b;
        },
      };
    },
  }),
}));

import { GET, PATCH } from "./route";
import type { NextRequest } from "next/server";

const admin = { userId: "u1", tenantId: "t1", role: "admin", industryId: "education_consultancy" };
const step = (n: number, delay: number, kind = "template", text = "t") => ({
  step_order: n, delay_days: delay, draft_source: kind, subject_template: `s${n}-${text}`, body_template: `b${n}-${text}`, ai_instructions: null,
});
const patch = (body: unknown) => PATCH({ json: async () => body } as unknown as NextRequest, { params: Promise.resolve({ id: "seq-1" }) });

beforeEach(() => {
  authMock.mockReset().mockResolvedValue(admin);
  ops = [];
  rpcCalls = [];
  rpcResult = { data: { locked_up_to: 3, steps_version: 1 }, error: null };
  tables = {
    email_sequences: [{ id: "seq-1", name: "Welcome" }],
    email_sequence_steps: [1, 2, 3, 4].map((n) => ({ id: `step-${n}`, sequence_id: "seq-1", ...step(n, n === 1 ? 0 : n) })),
    // one lead has handled step 2 (so step 3's draft exists), one just enrolled, one finished
    sequence_enrollments: [
      { id: "e1", sequence_id: "seq-1", status: "active", current_step_order: 2 },
      { id: "e2", sequence_id: "seq-1", status: "paused", current_step_order: 0 },
      { id: "e3", sequence_id: "seq-1", status: "completed", current_step_order: 4 },
    ],
  };
});

describe("PATCH sequence steps with leads running", () => {
  // seed: steps wait 0 / 2 / 3 / 4 days; the furthest lead has handled step 2, so steps 1..3 are in use

  const sentSteps = () => (rpcCalls[0].args.p_steps as Row[]);

  it("wording of ANY step can change (no structural change): handed to the database in one call", async () => {
    const res = await patch({ steps: [step(1, 0, "template", "new"), step(2, 2, "template", "new"), step(3, 3, "template", "new"), step(4, 4, "template", "new")] });
    expect(res.status).toBe(200);
    expect(rpcCalls).toHaveLength(1);
    expect(rpcCalls[0].fn).toBe("apply_sequence_steps");
    expect(rpcCalls[0].args.p_sequence_id).toBe("seq-1");
    expect(sentSteps().map((x) => x.subject_template)).toEqual(["s1-new", "s2-new", "s3-new", "s4-new"]);
  });

  it("steps after the ones leads have reached can be retimed and added", async () => {
    const res = await patch({ steps: [step(1, 0), step(2, 2), step(3, 3), step(4, 12), step(5, 5)] });

    expect(res.status).toBe(200);
    expect(sentSteps().map((x) => x.step_order)).toEqual([1, 2, 3, 4, 5]);
    expect(sentSteps().find((x) => x.step_order === 4)!.delay_days).toBe(12);
  });

  it("a step nobody has reached can be removed (it is simply absent from the list)", async () => {
    const res = await patch({ steps: [step(1, 0), step(2, 2), step(3, 3)] });
    expect(res.status).toBe(200);
    expect(sentSteps().map((x) => x.step_order)).toEqual([1, 2, 3]);
  });

  it("a step's own send time is passed on; an empty one is sent as null", async () => {
    // steps 1-3 are in use (their time is locked); step 4 and the new step 5 are free
    await patch({ steps: [step(1, 0), step(2, 2), step(3, 3), { ...step(4, 4), send_time: "15:30" }, { ...step(5, 5), send_time: "" }] });
    expect(sentSteps().map((x) => x.send_time)).toEqual([null, null, null, "15:30", null]);
  });

  it("refuses to change the wait of a step leads have reached — with a plain message, and changes nothing", async () => {
    const res = await patch({ steps: [step(1, 0), step(2, 2), step(3, 9), step(4, 4)] });

    expect(res.status).toBe(409);
    const json = (await res.json()) as { error: { message: string } };
    expect(json.error.message).toMatch(/Steps 1–3 are already in use/);
    expect(rpcCalls).toHaveLength(0); // refused before anything is written
    expect(ops).toEqual([]);
    expect(tables.email_sequence_steps.find((s) => s.step_order === 3)!.delay_days).toBe(3);
  });

  it("refuses to remove or reorder a step leads have reached", async () => {
    expect((await patch({ steps: [step(1, 0), step(3, 3), step(4, 4)] })).status).toBe(409); // dropped step 2
    expect((await patch({ steps: [step(1, 0), step(2, 3), step(3, 2), step(4, 4)] })).status).toBe(409); // swapped waits of 2 and 3
    expect(ops).toEqual([]);
  });

  it("writes the steps through ONE database call, never as separate inserts / updates / deletes from the route", async () => {
    await patch({ steps: [step(1, 0), step(2, 2), step(3, 3), step(5, 7)] }); // step 4 dropped, step 5 added

    expect(rpcCalls).toHaveLength(1);
    expect(ops.filter((o) => /:email_sequence_steps:/.test(o))).toEqual([]);
  });

  it("when a lead advanced after the route's own check, the database refuses with STEPS_LOCKED and that becomes the same plain 409", async () => {
    // the route's read says only steps 1-3 are locked; by the time the transaction runs a lead has reached step 4
    rpcResult = { data: null, error: { message: "STEPS_LOCKED", hint: "4" } };
    const res = await patch({ steps: [step(1, 0), step(2, 2), step(3, 3), step(4, 12)] });

    expect(res.status).toBe(409);
    const json = (await res.json()) as { error: { message: string } };
    expect(json.error.message).toMatch(/Steps 1–4 are already in use/);
  });

  it("any other database failure is a 500, not a silent success", async () => {
    rpcResult = { data: null, error: { message: "boom" } };
    expect((await patch({ steps: [step(1, 0), step(2, 2), step(3, 3), step(4, 4)] })).status).toBe(500);
  });

  it("with no lead running (only finished ones) any structural change is allowed", async () => {
    tables.sequence_enrollments = [{ id: "e3", sequence_id: "seq-1", status: "completed", current_step_order: 4 }];
    const res = await patch({ steps: [{ ...step(1, 5, "ai"), ai_instructions: "Be warm and brief." }, step(2, 1)] });
    expect(res.status).toBe(200);
    expect(sentSteps().map((x) => x.step_order)).toEqual([1, 2]);
  });

  it("GET reports how far leads have got so the editor can lock those steps", async () => {
    const res = await GET({} as NextRequest, { params: Promise.resolve({ id: "seq-1" }) });
    const json = (await res.json()) as { data: { locked_up_to: number; live_enrollments: number } };
    expect(json.data).toMatchObject({ locked_up_to: 3, live_enrollments: 2 });

    tables.sequence_enrollments = [];
    const none = (await (await GET({} as NextRequest, { params: Promise.resolve({ id: "seq-1" }) })).json()) as { data: { locked_up_to: number } };
    expect(none.data.locked_up_to).toBe(0);
  });

  it("403 for a non-admin, 422 for an invalid step list", async () => {
    authMock.mockResolvedValue({ ...admin, role: "viewer" });
    expect((await patch({ steps: [step(1, 0)] })).status).toBe(403);
    authMock.mockResolvedValue(admin);
    expect((await patch({ steps: [] })).status).toBe(422);
  });
});
