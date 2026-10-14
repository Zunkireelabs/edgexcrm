import { describe, it, expect, vi, beforeEach } from "vitest";

// GET /api/v1/leads/[id]/subscriptions — the Subscribed tab's data. Everything is faked (no DB): an in-memory model of the tables the
// route reads, filtered the way the route filters them, so the tests show what each user actually gets back.

type Row = Record<string, unknown>;
const LEAD_ID = "6f1c1c1e-1b2a-4c3d-8e9f-0a1b2c3d4e5f";
const OTHER_LEAD = "11111111-2222-4333-8444-555555555555";

const state = vi.hoisted(() => ({
  auth: null as Record<string, unknown> | null,
  lead: null as Row | null,
  collaborator: false,
  features: new Set<string>(),
  tables: {} as Record<string, Row[]>,
  failOn: null as string | null,
  queried: [] as string[],
}));

function makeChain(table: string) {
  const eq: Record<string, unknown> = {};
  const inList: Record<string, unknown[]> = {};
  let limit = Infinity;
  const run = (single: boolean) => {
    state.queried.push(table);
    if (table === "leads") return { data: single ? state.lead : [state.lead], error: null };
    if (state.failOn === table) return { data: null, error: { message: "boom" } };
    const rows = (state.tables[table] ?? []).filter(
      (r) => Object.entries(eq).every(([k, v]) => r[k] === v) && Object.entries(inList).every(([k, vs]) => vs.includes(r[k])),
    );
    return { data: rows.slice(0, limit).map((r) => ({ ...r })), error: null };
  };
  const chain: Record<string, unknown> = {
    select: () => chain,
    eq: (c: string, v: unknown) => { eq[c] = v; return chain; },
    in: (c: string, vs: unknown[]) => { inList[c] = vs; return chain; },
    is: () => chain,
    order: () => chain,
    limit: (n: number) => { limit = n; return chain; },
    maybeSingle: async () => run(true),
    then: (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) => Promise.resolve(run(false)).then(resolve, reject),
  };
  return chain;
}

vi.mock("@/lib/api/auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/api/auth")>();
  return { ...actual, authenticateRequest: vi.fn(async () => state.auth) };
});
vi.mock("@/industries/_loader", () => ({ getFeatureAccess: (_industry: string | null, feature: string) => state.features.has(feature) }));
vi.mock("@/lib/supabase/scoped", () => ({ scopedClient: vi.fn(async () => ({ from: (t: string) => makeChain(t), raw: () => ({}) })) }));
vi.mock("@/lib/leads/branch-membership", () => ({ getLeadMembership: vi.fn(async () => []) }));
vi.mock("@/lib/leads/collaborators", () => ({ isLeadCollaborator: vi.fn(async () => state.collaborator) }));
vi.mock("@/lib/logger", () => ({ createRequestLogger: () => ({ info: vi.fn(), error: vi.fn(), warn: vi.fn() }) }));

import { GET } from "./route";

const ctx = (id = LEAD_ID) => ({ params: Promise.resolve({ id }) });
const req = () => new Request(`http://localhost/api/v1/leads/${LEAD_ID}/subscriptions`) as unknown as Parameters<typeof GET>[0];
const asAuth = (perms: Record<string, unknown> = {}) => ({
  userId: "u-me", email: "c@x.com", tenantId: "t-1", role: "staff", industryId: "education_consultancy", branchId: null, branchMemberIds: [],
  permissions: { baseTier: "member", leadScope: "own", canEditLeads: true, ...perms },
});
const body = async (res: Response) => (await res.json()).data;

beforeEach(() => {
  state.auth = asAuth();
  state.lead = { id: LEAD_ID, assigned_to: "u-me", branch_id: null };
  state.collaborator = false;
  state.failOn = null;
  state.queried = [];
  state.features = new Set(["outreach", "email-campaigns", "sms"]);
  state.tables = {
    sequence_enrollments: [
      // Assigned to a colleague on purpose: the lead's visibility decides, not who works the enrollment.
      { id: "e-live", lead_id: LEAD_ID, sequence_id: "s-1", channel: "email", status: "active", current_step_order: 2, assigned_to: "u-colleague", started_at: "2026-10-10T00:00:00Z", completed_at: null, stopped_at: null, stop_reason: null, email_sequences: { name: "Welcome" } },
      { id: "e-done", lead_id: LEAD_ID, sequence_id: "s-2", channel: "sms", status: "unenrolled", current_step_order: 1, assigned_to: "u-me", started_at: "2026-09-01T00:00:00Z", completed_at: null, stopped_at: "2026-09-03T00:00:00Z", stop_reason: "replied", email_sequences: { name: "SMS nudge" } },
      { id: "e-other", lead_id: OTHER_LEAD, sequence_id: "s-1", channel: "email", status: "active", current_step_order: 1, assigned_to: "u-me", started_at: "2026-10-01T00:00:00Z", completed_at: null, stopped_at: null, stop_reason: null, email_sequences: { name: "Welcome" } },
    ],
    sequence_enrollment_queue: [
      { id: "q-1", lead_id: LEAD_ID, sequence_id: "s-3", channel: "email", status: "waiting", created_at: "2026-10-11T00:00:00Z", email_sequences: { name: "Follow-up" } },
      { id: "q-old", lead_id: LEAD_ID, sequence_id: "s-4", channel: "email", status: "cancelled", created_at: "2026-10-01T00:00:00Z", email_sequences: { name: "Old" } },
    ],
    email_messages: [
      { id: "m-1", lead_id: LEAD_ID, source: "blast", source_id: "b-1", status: "delivered", sent_at: "2026-10-05T00:00:00Z", created_at: "2026-10-05T00:00:00Z" },
      { id: "m-seq", lead_id: LEAD_ID, source: "sequence", source_id: "e-live", status: "sent", sent_at: "2026-10-11T00:00:00Z", created_at: "2026-10-11T00:00:00Z" },
    ],
    sms_messages: [
      { id: "t-1", lead_id: LEAD_ID, source: "blast", blast_id: "sb-1", status: "submitted", sent_at: null, created_at: "2026-10-07T00:00:00Z" },
    ],
    email_blasts: [{ id: "b-1", name: "Autumn intake" }],
    sms_blasts: [{ id: "sb-1", name: "Visa reminder" }],
  };
});

describe("GET subscriptions — access", () => {
  it("401 without a login", async () => {
    state.auth = null;
    expect((await GET(req(), ctx())).status).toBe(401);
  });
  it("403 for a tenant without Outreach", async () => {
    state.features = new Set();
    expect((await GET(req(), ctx())).status).toBe(403);
  });
  it("422 for a malformed lead id", async () => {
    expect((await GET(req(), ctx("nope"))).status).toBe(422);
  });
  it("404 when the lead does not exist", async () => {
    state.lead = null;
    expect((await GET(req(), ctx())).status).toBe(404);
  });
  it("an own-scope counselor gets 404 for someone else's lead (nothing revealed)", async () => {
    state.lead = { id: LEAD_ID, assigned_to: "someone-else", branch_id: null };
    expect((await GET(req(), ctx())).status).toBe(404);
    expect(state.queried).not.toContain("sequence_enrollments");
  });
  it("a collaborator on someone else's lead can see it", async () => {
    state.lead = { id: LEAD_ID, assigned_to: "someone-else", branch_id: null };
    state.collaborator = true;
    expect((await GET(req(), ctx())).status).toBe(200);
  });
  it("an all-leads user sees enrollments worked by a colleague (the outreach list would hide them)", async () => {
    state.auth = asAuth({ leadScope: "all" });
    state.lead = { id: LEAD_ID, assigned_to: "someone-else", branch_id: null };
    const data = await body(await GET(req(), ctx()));
    expect(data.sequences.map((s: { id: string }) => s.id)).toContain("e-live");
  });
});

describe("GET subscriptions — content", () => {
  it("returns this lead's sequences (live + past), its waiting queue and its campaigns — never another lead's", async () => {
    const data = await body(await GET(req(), ctx()));
    expect(data.sequences).toEqual([
      expect.objectContaining({ id: "e-live", sequenceName: "Welcome", channel: "email", status: "active", live: true, currentStep: 2, endedAt: null }),
      expect.objectContaining({ id: "e-done", sequenceName: "SMS nudge", channel: "sms", live: false, endedAt: "2026-09-03T00:00:00Z", stopReason: "replied" }),
    ]);
    expect(data.queued).toEqual([expect.objectContaining({ id: "q-1", sequenceName: "Follow-up", channel: "email" })]);
    // Sequence sends are not campaigns; newest first; names looked up.
    expect(data.campaigns).toEqual([
      expect.objectContaining({ id: "t-1", channel: "sms", name: "Visa reminder", status: "submitted", at: "2026-10-07T00:00:00Z" }),
      expect.objectContaining({ id: "m-1", channel: "email", name: "Autumn intake", status: "delivered", at: "2026-10-05T00:00:00Z" }),
    ]);
  });

  it("skips campaign kinds the tenant doesn't have", async () => {
    state.features = new Set(["outreach"]);
    const data = await body(await GET(req(), ctx()));
    expect(data.campaigns).toEqual([]);
    expect(state.queried).not.toContain("email_messages");
    expect(state.queried).not.toContain("sms_messages");
  });

  it("503 (not a half-empty answer) when a read fails", async () => {
    state.failOn = "sequence_enrollments";
    expect((await GET(req(), ctx())).status).toBe(503);
  });
});
