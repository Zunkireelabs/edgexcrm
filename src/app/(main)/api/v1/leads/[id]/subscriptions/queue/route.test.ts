import { describe, it, expect, vi, beforeEach } from "vitest";

// POST / DELETE /api/v1/leads/[id]/subscriptions/queue — "Queue next" from the lead page. No DB: an in-memory model of the tables, with
// the real queueNextSequence writing into it (including the one-waiting-row-per-lead-per-channel rule, migration 275).

type Row = Record<string, unknown>;
const LEAD_ID = "6f1c1c1e-1b2a-4c3d-8e9f-0a1b2c3d4e5f";
const OTHER_LEAD = "11111111-2222-4333-8444-555555555555";
const SEQ_RUNNING = "aaaaaaaa-0000-4000-8000-000000000001";
const SEQ_NEXT = "aaaaaaaa-0000-4000-8000-000000000002";
const SEQ_SMS = "aaaaaaaa-0000-4000-8000-000000000003";
const SEQ_ARCHIVED = "aaaaaaaa-0000-4000-8000-000000000004";
const Q_MINE = "bbbbbbbb-0000-4000-8000-000000000001";
const Q_OTHER = "bbbbbbbb-0000-4000-8000-000000000002";

const state = vi.hoisted(() => ({
  auth: null as Record<string, unknown> | null,
  lead: null as Row | null,
  features: new Set<string>(),
  tables: {} as Record<string, Row[]>,
  // Simulates "the current sequence ended right after the busy check": cleared once the queue row is written.
  endLiveOnQueueInsert: false,
  startQueued: vi.fn<(tenantId: string, leadId: string, channel: string) => Promise<string>>(async () => "started"),
}));

function makeChain(table: string) {
  let mode: "select" | "insert" | "update" = "select";
  let payload: Row = {};
  const eq: Record<string, unknown> = {};
  const inList: Record<string, unknown[]> = {};
  const rows = () => (state.tables[table] ??= []);
  const matches = (r: Row) =>
    Object.entries(eq).every(([k, v]) => r[k] === v) && Object.entries(inList).every(([k, vs]) => vs.includes(r[k]));
  const run = (single: boolean) => {
    if (table === "leads") return { data: single ? state.lead : [state.lead], error: null };
    if (mode === "insert") {
      if (table === "sequence_enrollment_queue") {
        // the BEFORE INSERT trigger stamps the channel from the sequence (migration 275)
        const seq = (state.tables.email_sequences ?? []).find((s) => s.id === payload.sequence_id);
        const channel = (seq?.channel as string) ?? "email";
        if (rows().some((r) => r.lead_id === payload.lead_id && r.channel === channel && r.status === "waiting")) {
          return { data: null, error: { code: "23505", message: "duplicate" } };
        }
        rows().push({ id: `q-${rows().length + 1}`, channel, ...payload });
        if (state.endLiveOnQueueInsert) state.tables.sequence_enrollments.forEach((e) => (e.status = "completed"));
      }
      return { data: null, error: null };
    }
    if (mode === "update") {
      const hit = rows().filter(matches);
      hit.forEach((r) => Object.assign(r, payload));
      return { data: hit.map((r) => ({ id: r.id })), error: null };
    }
    const found = rows().filter(matches).map((r) => ({ ...r }));
    return { data: single ? (found[0] ?? null) : found, error: null };
  };
  const chain: Record<string, unknown> = {
    select: () => chain,
    insert: (v: Row) => { mode = "insert"; payload = v; return chain; },
    update: (v: Row) => { mode = "update"; payload = v; return chain; },
    eq: (c: string, v: unknown) => { eq[c] = v; return chain; },
    in: (c: string, vs: unknown[]) => { inList[c] = vs; return chain; },
    is: () => chain,
    order: () => chain,
    maybeSingle: async () => run(true),
    then: (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) => Promise.resolve(run(false)).then(resolve, reject),
  };
  return chain;
}

vi.mock("@/lib/api/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api/auth")>();
  return { ...actual, authenticateRequest: vi.fn(async () => state.auth) };
});
vi.mock("@/industries/_loader", () => ({ getFeatureAccess: (_i: string | null, f: string) => state.features.has(f) }));
vi.mock("@/lib/supabase/scoped", () => ({ scopedClient: vi.fn(async () => ({ from: (t: string) => makeChain(t) })) }));
vi.mock("@/lib/sms/phone", () => ({ toProviderRecipient: (phone: string | null) => ({ ok: !!phone }) }));
vi.mock("@/lib/logger", () => ({
  createRequestLogger: () => ({ info: vi.fn(), error: vi.fn(), warn: vi.fn() }),
  logger: { info: vi.fn(), error: vi.fn(), warn: vi.fn() },
}));
// Keep the real queueNextSequence (it writes into the fake table); only the "start it now" step is observed.
vi.mock("@/industries/_shared/features/outreach/lib/queue-next", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/industries/_shared/features/outreach/lib/queue-next")>();
  return { ...actual, startQueuedEnrollment: (t: string, l: string, c: string) => state.startQueued(t, l, c) };
});

import { POST, DELETE } from "./route";

const ctx = (id = LEAD_ID) => ({ params: Promise.resolve({ id }) });
const post = (b: unknown) =>
  new Request(`http://localhost/api/v1/leads/${LEAD_ID}/subscriptions/queue`, { method: "POST", body: JSON.stringify(b) }) as unknown as Parameters<typeof POST>[0];
const del = (queueId: string) =>
  new Request(`http://localhost/api/v1/leads/${LEAD_ID}/subscriptions/queue?queue_id=${queueId}`, { method: "DELETE" }) as unknown as Parameters<typeof DELETE>[0];
const asAuth = (perms: Record<string, unknown> = {}) => ({
  userId: "u-me", email: "c@x.com", tenantId: "t-1", role: "staff", industryId: "education_consultancy", branchId: null, branchMemberIds: [],
  permissions: { baseTier: "member", leadScope: "own", canEditLeads: true, ...perms },
});
const message = async (res: Response) => (await res.json()).error?.message as string;
const waiting = () => (state.tables.sequence_enrollment_queue ?? []).filter((r) => r.status === "waiting");

beforeEach(() => {
  state.auth = asAuth();
  state.lead = { id: LEAD_ID, assigned_to: "u-me", phone: "+9779812345678" };
  state.features = new Set(["outreach"]);
  state.endLiveOnQueueInsert = false;
  state.startQueued.mockClear();
  state.tables = {
    email_sequences: [
      { id: SEQ_RUNNING, status: "active", channel: "email" },
      { id: SEQ_NEXT, status: "active", channel: "email" },
      { id: SEQ_SMS, status: "active", channel: "sms" },
      { id: SEQ_ARCHIVED, status: "archived", channel: "email" },
    ],
    sequence_enrollments: [{ id: "e-1", lead_id: LEAD_ID, sequence_id: SEQ_RUNNING, channel: "email", status: "active" }],
    sequence_enrollment_queue: [],
  };
});

describe("POST queue next", () => {
  it("queues a sequence behind the running one on the same channel", async () => {
    const res = await POST(post({ sequence_id: SEQ_NEXT }), ctx());
    expect(res.status).toBe(201);
    expect((await res.json()).data).toEqual({ queued: true, startedNow: false });
    expect(waiting()).toEqual([expect.objectContaining({ lead_id: LEAD_ID, sequence_id: SEQ_NEXT, channel: "email", queued_by: "u-me", run_id: null })]);
    expect(state.startQueued).not.toHaveBeenCalled();
  });

  it("refuses when that channel is free — the user should Enroll instead (nothing queued)", async () => {
    const res = await POST(post({ sequence_id: SEQ_SMS }), ctx());
    expect(res.status).toBe(409);
    expect(await message(res)).toMatch(/isn't in an SMS sequence/);
    expect(waiting()).toHaveLength(0);
  });

  it("refuses to queue the sequence that is already running", async () => {
    const res = await POST(post({ sequence_id: SEQ_RUNNING }), ctx());
    expect(res.status).toBe(409);
    expect(waiting()).toHaveLength(0);
  });

  it("refuses a second waiting sequence on the same channel, with a clear message", async () => {
    await POST(post({ sequence_id: SEQ_NEXT }), ctx());
    state.tables.email_sequences.push({ id: "aaaaaaaa-0000-4000-8000-000000000009", status: "active", channel: "email" });
    const res = await POST(post({ sequence_id: "aaaaaaaa-0000-4000-8000-000000000009" }), ctx());
    expect(res.status).toBe(409);
    expect(await message(res)).toMatch(/already has an email sequence waiting/);
    expect(waiting()).toHaveLength(1);
  });

  it("404 for an archived or unknown sequence", async () => {
    expect((await POST(post({ sequence_id: SEQ_ARCHIVED }), ctx())).status).toBe(404);
    expect((await POST(post({ sequence_id: "aaaaaaaa-0000-4000-8000-0000000000ff" }), ctx())).status).toBe(404);
    expect(waiting()).toHaveLength(0);
  });

  it("422 for an SMS sequence when the lead has no phone we can text", async () => {
    state.lead = { id: LEAD_ID, assigned_to: "u-me", phone: null };
    state.tables.sequence_enrollments.push({ id: "e-2", lead_id: LEAD_ID, sequence_id: "x", channel: "sms", status: "active" });
    expect((await POST(post({ sequence_id: SEQ_SMS }), ctx())).status).toBe(422);
  });

  it("starts the queued sequence straight away if the current one ended in the meantime (never left waiting forever)", async () => {
    state.endLiveOnQueueInsert = true;
    const res = await POST(post({ sequence_id: SEQ_NEXT }), ctx());
    expect(res.status).toBe(201);
    expect(state.startQueued).toHaveBeenCalledWith("t-1", LEAD_ID, "email");
    expect((await res.json()).data.startedNow).toBe(true);
  });

  it("access: 401 / 403 / 422 / own-scope counselor 404 on someone else's lead", async () => {
    state.auth = null;
    expect((await POST(post({ sequence_id: SEQ_NEXT }), ctx())).status).toBe(401);
    state.auth = asAuth();
    state.features = new Set();
    expect((await POST(post({ sequence_id: SEQ_NEXT }), ctx())).status).toBe(403);
    state.features = new Set(["outreach"]);
    expect((await POST(post({ sequence_id: "nope" }), ctx())).status).toBe(422);
    state.lead = { id: LEAD_ID, assigned_to: "someone-else", phone: "+9779812345678" };
    expect((await POST(post({ sequence_id: SEQ_NEXT }), ctx())).status).toBe(404);
    expect(waiting()).toHaveLength(0);
  });
});

describe("DELETE queue next", () => {
  beforeEach(() => {
    state.tables.sequence_enrollment_queue = [
      { id: Q_MINE, lead_id: LEAD_ID, sequence_id: SEQ_NEXT, channel: "email", status: "waiting" },
      { id: Q_OTHER, lead_id: OTHER_LEAD, sequence_id: SEQ_NEXT, channel: "email", status: "waiting" },
    ];
  });

  it("cancels this lead's waiting row", async () => {
    expect((await DELETE(del(Q_MINE), ctx())).status).toBe(200);
    expect(state.tables.sequence_enrollment_queue.find((r) => r.id === Q_MINE)?.status).toBe("cancelled");
  });

  it("never touches another lead's queue (404, row unchanged)", async () => {
    expect((await DELETE(del(Q_OTHER), ctx())).status).toBe(404);
    expect(state.tables.sequence_enrollment_queue.find((r) => r.id === Q_OTHER)?.status).toBe("waiting");
  });

  it("does not 'un-start' a sequence that already started (404)", async () => {
    state.tables.sequence_enrollment_queue[0].status = "started";
    expect((await DELETE(del(Q_MINE), ctx())).status).toBe(404);
    expect(state.tables.sequence_enrollment_queue[0].status).toBe("started");
  });

  it("422 for a malformed queue id; own-scope counselor 404 on someone else's lead", async () => {
    expect((await DELETE(del("nope"), ctx())).status).toBe(422);
    state.lead = { id: LEAD_ID, assigned_to: "someone-else", phone: null };
    expect((await DELETE(del(Q_MINE), ctx())).status).toBe(404);
    expect(state.tables.sequence_enrollment_queue[0].status).toBe("waiting");
  });
});
