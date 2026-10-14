import { describe, it, expect, vi, beforeEach } from "vitest";
import { PERMISSION_DENIED_MESSAGE } from "@/lib/permission-denied";

// GET / PUT /api/v1/leads/[id]/student-record — work experience, references and test scores. Everything is faked (no DB): an in-memory model of
// the three tables, so the tests assert what is actually STORED (including that another lead's rows are never touched).

type Row = Record<string, unknown>;
const LEAD_ID = "6f1c1c1e-1b2a-4c3d-8e9f-0a1b2c3d4e5f";
const OTHER_LEAD = "11111111-2222-4333-8444-555555555555";
// Stored rows have real UUID ids (gen_random_uuid()); a non-UUID id in a request is ignored by design.
const W1 = "aaaaaaaa-0000-4000-8000-000000000001";
const W2 = "aaaaaaaa-0000-4000-8000-000000000002";
const W_OTHER = "aaaaaaaa-0000-4000-8000-0000000000ff";
const S1 = "bbbbbbbb-0000-4000-8000-000000000001";

const state = vi.hoisted(() => ({
  auth: null as Record<string, unknown> | null,
  lead: null as Row | null,
  collaborator: false,
  tables: {} as Record<string, Row[]>,
  failOn: null as null | "insert" | "update" | "delete" | "select",
  audit: vi.fn<(input: Record<string, unknown>) => Promise<void>>(async () => undefined),
  leadUpdates: [] as Row[],
  nextId: 1,
}));

function makeChain(table: string) {
  let mode: "select" | "insert" | "update" | "delete" = "select";
  let payload: Row = {};
  const eq: Record<string, unknown> = {};
  const inList: Record<string, unknown[]> = {};

  const run = (single: boolean) => {
    if (table === "leads") {
      if (mode === "update") { state.leadUpdates.push(payload); return { data: null, error: null }; }
      return { data: single ? state.lead : [state.lead], error: null };
    }
    const rows = (state.tables[table] ??= []);
    const matches = (r: Row) =>
      Object.entries(eq).every(([k, v]) => r[k] === v) && Object.entries(inList).every(([k, vs]) => vs.includes(r[k]));
    if (state.failOn === mode) return { data: null, error: { message: "boom" } };
    if (mode === "insert") { rows.push({ id: `row-${state.nextId++}`, ...payload }); return { data: null, error: null }; }
    if (mode === "update") { rows.filter(matches).forEach((r) => Object.assign(r, payload)); return { data: null, error: null }; }
    if (mode === "delete") { state.tables[table] = rows.filter((r) => !matches(r)); return { data: null, error: null }; }
    return { data: rows.filter(matches).map((r) => ({ ...r })), error: null };
  };

  const chain: Record<string, unknown> = {
    select: () => chain,
    insert: (v: Row) => { mode = "insert"; payload = v; return chain; },
    update: (v: Row) => { mode = "update"; payload = v; return chain; },
    delete: () => { mode = "delete"; return chain; },
    eq: (c: string, v: unknown) => { eq[c] = v; return chain; },
    is: () => chain,
    in: (c: string, vs: unknown[]) => { inList[c] = vs; return chain; },
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
vi.mock("@/industries/_loader", () => ({ getFeatureAccess: (industry: string | null) => industry === "education_consultancy" }));
vi.mock("@/lib/supabase/scoped", () => ({ scopedClient: vi.fn(async () => ({ from: (t: string) => makeChain(t), raw: () => ({}) })) }));
vi.mock("@/lib/leads/branch-membership", () => ({ getLeadMembership: vi.fn(async () => []) }));
vi.mock("@/lib/leads/collaborators", () => ({ isLeadCollaborator: vi.fn(async () => state.collaborator) }));
vi.mock("@/lib/api/audit", () => ({ createAuditLog: (input: Record<string, unknown>) => state.audit(input) }));
vi.mock("@/lib/logger", () => ({ createRequestLogger: () => ({ info: vi.fn(), error: vi.fn(), warn: vi.fn() }) }));

import { GET, PUT } from "./route";

const ctx = (id = LEAD_ID) => ({ params: Promise.resolve({ id }) });
const getReq = () => new Request(`http://localhost/api/v1/leads/${LEAD_ID}/student-record`) as unknown as Parameters<typeof GET>[0];
const putReq = (body: unknown) =>
  new Request(`http://localhost/api/v1/leads/${LEAD_ID}/student-record`, { method: "PUT", body: typeof body === "string" ? body : JSON.stringify(body) }) as unknown as Parameters<typeof PUT>[0];
const asAuth = (over: Record<string, unknown> = {}, perms: Record<string, unknown> = {}) => ({
  userId: "u-me", email: "c@x.com", tenantId: "t-1", role: "staff", industryId: "education_consultancy", branchId: null, branchMemberIds: [],
  permissions: { baseTier: "member", leadScope: "own", canEditLeads: true, ...perms },
  ...over,
});
const error = async (res: Response) => (await res.json()).error as { code: string; message: string; details?: Record<string, string[]> };
const stored = (table: string) => state.tables[table] ?? [];

beforeEach(() => {
  state.auth = asAuth();
  state.lead = { id: LEAD_ID, assigned_to: "u-me", branch_id: null };
  state.collaborator = false;
  state.failOn = null;
  state.nextId = 1;
  state.leadUpdates = [];
  state.audit.mockClear();
  state.tables = {
    lead_work_experience: [
      { id: W1, lead_id: LEAD_ID, institution_name: "Old Org", address: null, position: "Clerk", start_date: "2020-01-01", end_date: null },
      { id: W2, lead_id: LEAD_ID, institution_name: "To Remove", address: null, position: null, start_date: null, end_date: null },
      { id: W_OTHER, lead_id: OTHER_LEAD, institution_name: "Someone else's", address: null, position: null, start_date: null, end_date: null },
    ],
    lead_references: [],
    lead_test_scores: [{ id: S1, lead_id: LEAD_ID, exam_type: "IELTS", date_of_exam: null, listening: null, reading: null, writing: null, speaking: null, overall: "7" }],
  };
});

describe("student-record — access", () => {
  it("401 without a login", async () => {
    state.auth = null;
    expect((await GET(getReq(), ctx())).status).toBe(401);
    expect((await PUT(putReq({}), ctx())).status).toBe(401);
  });
  it("403 outside the education industry", async () => {
    state.auth = asAuth({ industryId: "it_agency" });
    expect((await GET(getReq(), ctx())).status).toBe(403);
    expect((await PUT(putReq({}), ctx())).status).toBe(403);
  });
  it("rejects a malformed lead id", async () => {
    expect((await GET(getReq(), ctx("nope"))).status).toBe(422);
    expect((await PUT(putReq({}), ctx("nope"))).status).toBe(422);
  });
  it("404 when the lead does not exist", async () => {
    state.lead = null;
    expect((await GET(getReq(), ctx())).status).toBe(404);
    expect((await PUT(putReq({ references: [] }), ctx())).status).toBe(404);
  });
  it("an own-scope counselor cannot read or write a lead that is not theirs (404 — nothing revealed)", async () => {
    state.lead = { id: LEAD_ID, assigned_to: "someone-else", branch_id: null };
    expect((await GET(getReq(), ctx())).status).toBe(404);
    const res = await PUT(putReq({ references: [{ referee_name: "X" }] }), ctx());
    expect(res.status).toBe(404);
    expect(stored("lead_references")).toHaveLength(0);
  });
  it("a collaborator can read it but not write it", async () => {
    state.lead = { id: LEAD_ID, assigned_to: "someone-else", branch_id: null };
    state.collaborator = true;
    expect((await GET(getReq(), ctx())).status).toBe(200);
    expect((await PUT(putReq({ references: [{ referee_name: "X" }] }), ctx())).status).toBe(404);
  });
  it("a view-only user can read but is refused a write with the standard no-permission message", async () => {
    state.auth = asAuth({ role: "viewer" }, { leadScope: "all", canEditLeads: false });
    expect((await GET(getReq(), ctx())).status).toBe(200);
    const res = await PUT(putReq({ references: [{ referee_name: "X" }] }), ctx());
    expect(res.status).toBe(403);
    expect((await error(res)).message).toBe(PERMISSION_DENIED_MESSAGE);
    expect(stored("lead_references")).toHaveLength(0);
  });
  it("owners and admins may write on any lead", async () => {
    state.auth = asAuth({ role: "owner" }, { baseTier: "owner", leadScope: "all" });
    state.lead = { id: LEAD_ID, assigned_to: "someone-else", branch_id: null };
    expect((await PUT(putReq({ references: [{ referee_name: "X" }] }), ctx())).status).toBe(200);
  });
});

describe("GET", () => {
  it("returns the three stored lists for THIS lead only", async () => {
    const data = (await (await GET(getReq(), ctx())).json()).data;
    expect(data.work_experience.map((r: Row) => r.id).sort()).toEqual([W1, W2].sort());
    expect(data.work_experience.some((r: Row) => r.id === W_OTHER)).toBe(false);
    expect(data.references).toEqual([]);
    expect(data.test_scores).toHaveLength(1);
  });
});

describe("PUT — validation", () => {
  it("refuses a malformed body", async () => {
    expect((await PUT(putReq("not json"), ctx())).status).toBe(422);
    expect((await PUT(putReq([1, 2]), ctx())).status).toBe(422);
  });
  it("refuses a bad date, a bad email, an unknown exam and a missing exam type — keyed per row — and stores NOTHING", async () => {
    const before = JSON.stringify(state.tables);
    const res = await PUT(
      putReq({
        work_experience: [{ institution_name: "A", start_date: "01/02/2020" }],
        references: [{ referee_name: "B", email: "nope" }],
        test_scores: [{ exam_type: "Made-up", overall: "5" }, { overall: "6" }],
      }),
      ctx(),
    );
    expect(res.status).toBe(422);
    expect(Object.keys((await error(res)).details ?? {}).sort()).toEqual([
      "references[0].email", "test_scores[0].exam_type", "test_scores[1].exam_type", "work_experience[0].start_date",
    ]);
    expect(JSON.stringify(state.tables)).toBe(before);
    expect(state.audit).not.toHaveBeenCalled();
  });
  it("refuses more rows than allowed", async () => {
    const rows = Array.from({ length: 26 }, (_, i) => ({ institution_name: `Org ${i}` }));
    expect((await PUT(putReq({ work_experience: rows }), ctx())).status).toBe(422);
  });
});

describe("PUT — what is stored", () => {
  it("inserts new rows with SERVER-made ids (a client id is never used as a key), and returns what was stored", async () => {
    const clientId = "22222222-3333-4444-8555-666666666666";
    const res = await PUT(putReq({ references: [{ id: clientId, referee_name: "Dr Rai", email: "rai@x.co", relationship: "Teacher" }] }), ctx());
    expect(res.status).toBe(200);
    const refs = stored("lead_references");
    expect(refs).toHaveLength(1);
    expect(refs[0]).toMatchObject({ lead_id: LEAD_ID, referee_name: "Dr Rai", email: "rai@x.co", relationship: "Teacher", position: null });
    expect(refs[0].id).not.toBe(clientId);
    expect((await res.json()).data.references[0].referee_name).toBe("Dr Rai");
  });

  it("updates a row it already stores for this lead (keeps its id) and deletes the ones that are no longer listed", async () => {
    const res = await PUT(putReq({ work_experience: [{ id: W1, institution_name: "New Org", position: "Manager" }] }), ctx());
    expect(res.status).toBe(200);
    const mine = stored("lead_work_experience").filter((r) => r.lead_id === LEAD_ID);
    expect(mine).toHaveLength(1);
    expect(mine[0]).toMatchObject({ id: W1, institution_name: "New Org", position: "Manager", start_date: null });
  });

  it("NEVER touches another lead's rows — not by update, not by delete, even when asked to by id", async () => {
    await PUT(putReq({ work_experience: [{ id: W_OTHER, institution_name: "Hijack attempt" }] }), ctx());
    const other = stored("lead_work_experience").find((r) => r.id === W_OTHER);
    expect(other).toMatchObject({ lead_id: OTHER_LEAD, institution_name: "Someone else's" });
    // ...and the attempt became a normal new row on THIS lead
    expect(stored("lead_work_experience").some((r) => r.lead_id === LEAD_ID && r.institution_name === "Hijack attempt")).toBe(true);
  });

  it("an empty list clears the stored rows", async () => {
    await PUT(putReq({ work_experience: [] }), ctx());
    expect(stored("lead_work_experience").filter((r) => r.lead_id === LEAD_ID)).toHaveLength(0);
    expect(stored("lead_work_experience").some((r) => r.id === W_OTHER)).toBe(true);
  });

  it("a list that is not in the request is left untouched", async () => {
    await PUT(putReq({ references: [{ referee_name: "A" }] }), ctx());
    expect(stored("lead_test_scores")).toHaveLength(1);
    expect(stored("lead_work_experience").filter((r) => r.lead_id === LEAD_ID)).toHaveLength(2);
  });

  it("an 'Add' row nobody typed into is not stored", async () => {
    await PUT(putReq({ references: [{ referee_name: "  " }, { referee_name: "Real" }] }), ctx());
    expect(stored("lead_references")).toHaveLength(1);
  });

  it("stores every test-score field, including Duolingo and the skill breakdown", async () => {
    await PUT(
      putReq({
        test_scores: [
          { id: S1, exam_type: "IELTS", date_of_exam: "2026-03-01", listening: "8", reading: "7.5", writing: "6.5", speaking: "7", overall: "7.5" },
          { exam_type: "Duolingo English Test", overall: "120" },
        ],
      }),
      ctx(),
    );
    const scores = stored("lead_test_scores");
    expect(scores).toHaveLength(2);
    expect(scores.find((r) => r.id === S1)).toMatchObject({ date_of_exam: "2026-03-01", listening: "8", reading: "7.5", writing: "6.5", speaking: "7", overall: "7.5" });
    expect(scores.find((r) => r.exam_type === "Duolingo English Test")).toMatchObject({ overall: "120", lead_id: LEAD_ID });
  });

  it("records the change in the audit log with the before/after counts, and marks the lead updated", async () => {
    await PUT(putReq({ work_experience: [{ institution_name: "Only one" }] }), ctx());
    expect(state.audit).toHaveBeenCalledTimes(1);
    expect(state.audit.mock.calls[0][0]).toMatchObject({
      tenantId: "t-1", userId: "u-me", action: "lead.updated", entityType: "lead", entityId: LEAD_ID,
      changes: { work_experience: { old: 2, new: 1 } },
    });
    expect(state.leadUpdates[0]).toHaveProperty("updated_at");
  });

  it("a request with no lists changes nothing and logs nothing", async () => {
    const res = await PUT(putReq({ first_name: "X" }), ctx());
    expect(res.status).toBe(200);
    expect(state.audit).not.toHaveBeenCalled();
  });

  it.each(["insert", "update", "delete"] as const)("a failed %s answers 503 and does not claim success in the audit log", async (op) => {
    state.failOn = op;
    const res = await PUT(putReq({ work_experience: [{ id: W1, institution_name: "Changed" }, { institution_name: "Brand new" }] }), ctx());
    expect(res.status).toBe(503);
    expect(state.audit).not.toHaveBeenCalled();
  });
});
