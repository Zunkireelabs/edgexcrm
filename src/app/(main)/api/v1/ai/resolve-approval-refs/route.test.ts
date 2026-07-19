import { describe, it, expect, vi, beforeEach } from "vitest";
import type { NextRequest } from "next/server";
import type { AuthContext } from "@/lib/api/auth";
import { resolvePermissions } from "@/lib/api/permissions";

const isAssistantEnabledMock = vi.fn();
const authenticateRequestMock = vi.fn();
const scopedClientMock = vi.fn();

vi.mock("@/lib/ai/flag", () => ({ isAssistantEnabled: isAssistantEnabledMock }));
vi.mock("@/lib/api/auth", () => ({ authenticateRequest: authenticateRequestMock }));
vi.mock("@/lib/supabase/scoped", () => ({ scopedClient: scopedClientMock }));

// @/lib/api/permissions and the lead-visibility helpers (canViewLead, getLeadMembership,
// isLeadCollaborator) are deliberately NOT mocked — these tests exercise the real
// permission logic against a fake data layer, which is the whole point of BRIEF-PHASE-4D-FIXUP.
const ADMIN_AUTH = {
  userId: "admin-1",
  tenantId: "tenant-1",
  industryId: "education_consultancy",
  positionSlug: null,
  branchId: null,
  branchMemberIds: [],
  permissions: resolvePermissions("owner", null),
} as unknown as AuthContext;

const COUNSELOR_AUTH = {
  userId: "counselor-1",
  tenantId: "tenant-1",
  industryId: "education_consultancy",
  positionSlug: null,
  branchId: null,
  branchMemberIds: [],
  permissions: resolvePermissions("counselor", null), // leadScope: "own"
} as unknown as AuthContext;

function fakeReq(body: unknown): NextRequest {
  return { json: () => Promise.resolve(body) } as unknown as NextRequest;
}

/** A `.from(table).select(...).eq/.is/.in/.order/.limit(...).maybeSingle()` chain whose
 * result is computed from whatever filters were applied, so one table double can serve
 * every query shape (`.eq("id", x)` vs `.eq("user_id", x).in(...)`) a test needs. Also
 * thenable directly after the filter chain (no `.maybeSingle()`), for callers like
 * getLeadMembership that just `await` a plain multi-row select. */
function chainableTable(resolve: (filters: Record<string, unknown>) => unknown) {
  return {
    select: vi.fn(() => {
      const filters: Record<string, unknown> = {};
      const chain = {
        eq: vi.fn((col: string, val: unknown) => {
          filters[col] = val;
          return chain;
        }),
        is: vi.fn((col: string, val: unknown) => {
          filters[col] = val;
          return chain;
        }),
        in: vi.fn((col: string, val: unknown) => {
          filters[col] = val;
          return chain;
        }),
        order: vi.fn(() => chain),
        limit: vi.fn(() => chain),
        maybeSingle: vi.fn(() => Promise.resolve({ data: resolve(filters) })),
        then: (onFulfilled: (v: { data: unknown; error: null }) => unknown, onRejected?: (e: unknown) => unknown) =>
          Promise.resolve({ data: resolve(filters), error: null }).then(onFulfilled, onRejected),
      };
      return chain;
    }),
  };
}

interface FakeLead {
  first_name: string | null;
  last_name: string | null;
  display_id: string | null;
  assigned_to: string | null;
  branch_id?: string | null;
  pipeline_id?: string;
  list_id?: string | null;
}

interface FakeDbOpts {
  leads?: Record<string, FakeLead>;
  tenantUsers?: Set<string>;
  knowledgeBases?: Record<string, unknown>;
  leadLists?: Record<string, unknown>;
  aiWriteActionsMostRecent?: unknown;
  getUserById?: ReturnType<typeof vi.fn>;
}

function fakeDb(opts: FakeDbOpts) {
  const getUserById = opts.getUserById ?? vi.fn(() => Promise.resolve({ data: { user: null } }));

  return {
    from: vi.fn((table: string) => {
      switch (table) {
        case "leads":
          return chainableTable((f) => (f.id && opts.leads?.[f.id as string]) ?? null);
        case "tenant_users":
          return chainableTable((f) => (opts.tenantUsers?.has(f.user_id as string) ? { user_id: f.user_id } : null));
        case "knowledge_bases":
          return chainableTable((f) => (f.id && opts.knowledgeBases?.[f.id as string]) ?? null);
        case "lead_lists":
          return chainableTable((f) => (f.id && opts.leadLists?.[f.id as string]) ?? null);
        // canViewLead's dependencies — no test here needs actual branch/collaborator rows
        // (the fixtures put assignment directly on the lead row), so both are always empty.
        case "lead_branches":
          return chainableTable(() => []);
        case "lead_collaborators":
          return chainableTable(() => null);
        case "ai_write_actions":
          return chainableTable((f) => {
            const recent = opts.aiWriteActionsMostRecent;
            if (!recent || typeof recent !== "object") return null;
            // Models the real query's .eq("user_id", auth.userId) — a fixture
            // belonging to a different user must never surface to this caller
            // (BRIEF-PHASE-4F: the most-recent query is the only path now, so
            // this filter IS the ownership guarantee, not a post-fetch check).
            const row = recent as { user_id: string };
            if (f.user_id && row.user_id !== f.user_id) return null;
            return row;
          });
        default:
          throw new Error(`unexpected table: ${table}`);
      }
    }),
    raw: vi.fn(() => ({ auth: { admin: { getUserById } } })),
  };
}

const LEAD_ID = "22222222-2222-2222-2222-222222222222";
const ASSIGNEE_ID = "11111111-1111-1111-1111-111111111111";
const OUTSIDER_ID = "99999999-9999-9999-9999-999999999999";
const KB_ID = "33333333-3333-3333-3333-333333333333";
const ACTION_ID = "44444444-4444-4444-4444-444444444444";
const LIST_ID = "55555555-5555-5555-5555-555555555555";
const OTHER_LEAD_ID = "66666666-6666-6666-6666-666666666666";

const RIYA: FakeLead = { first_name: "Riya", last_name: "Sharma", display_id: "ADM-001", assigned_to: null };

describe("POST /api/v1/ai/resolve-approval-refs", () => {
  beforeEach(() => {
    isAssistantEnabledMock.mockReset();
    authenticateRequestMock.mockReset();
    scopedClientMock.mockReset();
    isAssistantEnabledMock.mockReturnValue(true);
    authenticateRequestMock.mockResolvedValue(ADMIN_AUTH);
  });

  it("404s when the assistant flag is off", async () => {
    isAssistantEnabledMock.mockReturnValue(false);
    const { POST } = await import("./route");
    const res = await POST(fakeReq({ refs: [{ kind: "lead", id: LEAD_ID }] }));
    expect(res.status).toBe(404);
  });

  it("401s when unauthenticated", async () => {
    authenticateRequestMock.mockResolvedValue(null);
    const { POST } = await import("./route");
    const res = await POST(fakeReq({ refs: [{ kind: "lead", id: LEAD_ID }] }));
    expect(res.status).toBe(401);
  });

  it("422s on a missing/empty refs array", async () => {
    const { POST } = await import("./route");
    const res = await POST(fakeReq({}));
    expect(res.status).toBe(422);
  });

  it("422s on an unknown ref kind", async () => {
    const { POST } = await import("./route");
    const res = await POST(fakeReq({ refs: [{ kind: "secret_table", id: LEAD_ID }] }));
    expect(res.status).toBe(422);
  });

  it("422s on a malformed (non-UUID) id", async () => {
    const { POST } = await import("./route");
    const res = await POST(fakeReq({ refs: [{ kind: "lead", id: "not-a-uuid" }] }));
    expect(res.status).toBe(422);
  });

  it("resolves a lead to its name + display id (admin, full tenant visibility)", async () => {
    scopedClientMock.mockResolvedValue(fakeDb({ leads: { [LEAD_ID]: RIYA } }));
    const { POST } = await import("./route");
    const res = await POST(fakeReq({ refs: [{ kind: "lead", id: LEAD_ID }] }));
    const body = await res.json();
    expect(body.data.resolved[`lead:${LEAD_ID}`]).toEqual({ label: "Riya Sharma (ADM-001)" });
  });

  it("resolves a lead id that doesn't exist in this tenant as NOT FOUND", async () => {
    scopedClientMock.mockResolvedValue(fakeDb({ leads: {} }));
    const { POST } = await import("./route");
    const res = await POST(fakeReq({ refs: [{ kind: "lead", id: OUTSIDER_ID }] }));
    const body = await res.json();
    expect(body.data.resolved[`lead:${OUTSIDER_ID}`]).toEqual({ notFound: true });
  });

  describe("counselor lead-scope restriction (BRIEF-PHASE-4D-FIXUP finding 1)", () => {
    it("a counselor resolving a lead outside their scope gets NOT FOUND — the test that matters", async () => {
      authenticateRequestMock.mockResolvedValue(COUNSELOR_AUTH);
      scopedClientMock.mockResolvedValue(fakeDb({ leads: { [LEAD_ID]: { ...RIYA, assigned_to: "someone-else" } } }));
      const { POST } = await import("./route");
      const res = await POST(fakeReq({ refs: [{ kind: "lead", id: LEAD_ID }] }));
      const body = await res.json();
      expect(body.data.resolved[`lead:${LEAD_ID}`]).toEqual({ notFound: true });
    });

    it("a counselor resolving their own assigned lead resolves normally", async () => {
      authenticateRequestMock.mockResolvedValue(COUNSELOR_AUTH);
      scopedClientMock.mockResolvedValue(fakeDb({ leads: { [LEAD_ID]: { ...RIYA, assigned_to: COUNSELOR_AUTH.userId } } }));
      const { POST } = await import("./route");
      const res = await POST(fakeReq({ refs: [{ kind: "lead", id: LEAD_ID }] }));
      const body = await res.json();
      expect(body.data.resolved[`lead:${LEAD_ID}`]).toEqual({ label: "Riya Sharma (ADM-001)" });
    });

    it("an admin resolving the SAME out-of-scope-for-counselor lead still resolves — proves this scopes rather than blanket-denying", async () => {
      authenticateRequestMock.mockResolvedValue(ADMIN_AUTH);
      scopedClientMock.mockResolvedValue(fakeDb({ leads: { [LEAD_ID]: { ...RIYA, assigned_to: "someone-else" } } }));
      const { POST } = await import("./route");
      const res = await POST(fakeReq({ refs: [{ kind: "lead", id: LEAD_ID }] }));
      const body = await res.json();
      expect(body.data.resolved[`lead:${LEAD_ID}`]).toEqual({ label: "Riya Sharma (ADM-001)" });
    });

    it("an out-of-scope lead and a nonexistent lead produce byte-identical responses", async () => {
      authenticateRequestMock.mockResolvedValue(COUNSELOR_AUTH);
      scopedClientMock.mockResolvedValue(fakeDb({ leads: { [LEAD_ID]: { ...RIYA, assigned_to: "someone-else" } } }));
      const { POST: postOutOfScope } = await import("./route");
      const outOfScopeRes = await postOutOfScope(fakeReq({ refs: [{ kind: "lead", id: LEAD_ID }] }));
      const outOfScopeBody = await outOfScopeRes.json();

      scopedClientMock.mockResolvedValue(fakeDb({ leads: {} }));
      const { POST: postNonexistent } = await import("./route");
      const nonexistentRes = await postNonexistent(fakeReq({ refs: [{ kind: "lead", id: LEAD_ID }] }));
      const nonexistentBody = await nonexistentRes.json();

      expect(outOfScopeBody.data.resolved[`lead:${LEAD_ID}`]).toEqual(nonexistentBody.data.resolved[`lead:${LEAD_ID}`]);
      expect(outOfScopeBody.data.resolved[`lead:${LEAD_ID}`]).toEqual({ notFound: true });
    });
  });

  it("resolves an assignee (tenant member) via name, falling back to email", async () => {
    const getUserById = vi.fn(() => Promise.resolve({ data: { user: { email: "anish@example.com", user_metadata: {} } } }));
    scopedClientMock.mockResolvedValue(fakeDb({ tenantUsers: new Set([ASSIGNEE_ID]), getUserById }));
    const { POST } = await import("./route");
    const res = await POST(fakeReq({ refs: [{ kind: "assignee", id: ASSIGNEE_ID }] }));
    const body = await res.json();
    expect(body.data.resolved[`assignee:${ASSIGNEE_ID}`]).toEqual({ label: "anish@example.com" });
    expect(getUserById).toHaveBeenCalledWith(ASSIGNEE_ID);
  });

  it("cross-tenant safety: a user id belonging to another tenant resolves as NOT FOUND, never as that user's real name", async () => {
    // auth.users has no tenant concept — outsider-id is a real Supabase Auth user, just not
    // a member of THIS tenant's tenant_users. The route must never call getUserById() for it.
    const getUserById = vi.fn(() => Promise.resolve({ data: { user: { email: "someone@other-tenant.com", user_metadata: { name: "Someone Else" } } } }));
    scopedClientMock.mockResolvedValue(fakeDb({ tenantUsers: new Set([ASSIGNEE_ID]), getUserById }));
    const { POST } = await import("./route");
    const res = await POST(fakeReq({ refs: [{ kind: "assignee", id: OUTSIDER_ID }] }));
    const body = await res.json();
    expect(body.data.resolved[`assignee:${OUTSIDER_ID}`]).toEqual({ notFound: true });
    expect(getUserById).not.toHaveBeenCalled();
  });

  it("resolves a knowledge base by name", async () => {
    scopedClientMock.mockResolvedValue(fakeDb({ knowledgeBases: { [KB_ID]: { name: "Sales playbook" } } }));
    const { POST } = await import("./route");
    const res = await POST(fakeReq({ refs: [{ kind: "knowledge_base", id: KB_ID }] }));
    const body = await res.json();
    expect(body.data.resolved[`knowledge_base:${KB_ID}`]).toEqual({ label: "Sales playbook" });
  });

  it("describes an undo_lead_action target (update_lead_stage) as a sentence, not an id — BRIEF-PHASE-4F: undo_action always resolves the caller's most recent action, id is always null", async () => {
    scopedClientMock.mockResolvedValue(
      fakeDb({
        leads: { [LEAD_ID]: RIYA },
        leadLists: { [LIST_ID]: { name: "Pre-qualified" } },
        aiWriteActionsMostRecent: {
          id: ACTION_ID,
          tool_id: "update_lead_stage",
          user_id: ADMIN_AUTH.userId,
          input: { leadId: LEAD_ID },
          result: { stage: "Qualified", previous: { list_id: LIST_ID } },
          created_at: "2026-07-19T11:55:00.000Z",
        },
      }),
    );
    const { POST } = await import("./route");
    const res = await POST(fakeReq({ refs: [{ kind: "undo_action", id: null }] }));
    const body = await res.json();
    const resolved = body.data.resolved["undo_action:latest"];
    expect(resolved.notFound).toBeUndefined();
    expect(resolved.label).toContain("Riya Sharma (ADM-001)");
    expect(resolved.label).toContain("Pre-qualified → Qualified");
    expect(resolved.label).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/);
  });

  it("resolves undo_action with no undoable action to NOT FOUND", async () => {
    scopedClientMock.mockResolvedValue(fakeDb({ aiWriteActionsMostRecent: null }));
    const { POST } = await import("./route");
    const res = await POST(fakeReq({ refs: [{ kind: "undo_action", id: null }] }));
    const body = await res.json();
    expect(body.data.resolved["undo_action:latest"]).toEqual({ notFound: true });
  });

  it("dedupes identical refs into a single resolution", async () => {
    scopedClientMock.mockResolvedValue(fakeDb({ leads: { [LEAD_ID]: RIYA } }));
    const { POST } = await import("./route");
    const res = await POST(
      fakeReq({
        refs: [
          { kind: "lead", id: LEAD_ID },
          { kind: "lead", id: LEAD_ID },
        ],
      }),
    );
    const body = await res.json();
    expect(Object.keys(body.data.resolved)).toEqual([`lead:${LEAD_ID}`]);
  });

  describe("undo user-scope restriction (BRIEF-PHASE-4D-FIXUP finding 2 — enforced via the most-recent query's own .eq(\"user_id\", ...) since BRIEF-PHASE-4F removed the by-id path)", () => {
    const OTHER_USER_ACTION = {
      id: ACTION_ID,
      tool_id: "update_lead_stage",
      user_id: "someone-else",
      input: { leadId: LEAD_ID },
      result: { stage: "Qualified", previous: { list_id: LIST_ID } },
      created_at: "2026-07-19T11:55:00.000Z",
    };

    it("a most-recent-action fixture belonging to a different user never resolves for this caller", async () => {
      scopedClientMock.mockResolvedValue(
        fakeDb({
          leads: { [LEAD_ID]: RIYA },
          leadLists: { [LIST_ID]: { name: "Pre-qualified" } },
          aiWriteActionsMostRecent: OTHER_USER_ACTION,
        }),
      );
      const { POST } = await import("./route");
      const res = await POST(fakeReq({ refs: [{ kind: "undo_action", id: null }] }));
      const body = await res.json();
      expect(body.data.resolved["undo_action:latest"]).toEqual({ notFound: true });
    });

    it("the caller's own most-recent action resolves normally", async () => {
      scopedClientMock.mockResolvedValue(
        fakeDb({
          leads: { [LEAD_ID]: RIYA },
          leadLists: { [LIST_ID]: { name: "Pre-qualified" } },
          aiWriteActionsMostRecent: { ...OTHER_USER_ACTION, user_id: ADMIN_AUTH.userId },
        }),
      );
      const { POST } = await import("./route");
      const res = await POST(fakeReq({ refs: [{ kind: "undo_action", id: null }] }));
      const body = await res.json();
      expect(body.data.resolved["undo_action:latest"].notFound).toBeUndefined();
      expect(body.data.resolved["undo_action:latest"].label).toContain("Riya Sharma (ADM-001)");
    });

    it("an undo whose target lead is outside the caller's scope shows the lead as NOT FOUND, rest of the sentence intact", async () => {
      authenticateRequestMock.mockResolvedValue(COUNSELOR_AUTH);
      scopedClientMock.mockResolvedValue(
        fakeDb({
          leads: { [OTHER_LEAD_ID]: { ...RIYA, assigned_to: "someone-else" } },
          leadLists: { [LIST_ID]: { name: "Pre-qualified" } },
          aiWriteActionsMostRecent: {
            id: ACTION_ID,
            tool_id: "update_lead_stage",
            user_id: COUNSELOR_AUTH.userId,
            input: { leadId: OTHER_LEAD_ID },
            result: { stage: "Qualified", previous: { list_id: LIST_ID } },
            created_at: "2026-07-19T11:55:00.000Z",
          },
        }),
      );
      const { POST } = await import("./route");
      const res = await POST(fakeReq({ refs: [{ kind: "undo_action", id: null }] }));
      const body = await res.json();
      const label: string = body.data.resolved["undo_action:latest"].label;
      expect(label).toContain(`NOT FOUND (${OTHER_LEAD_ID})`);
      expect(label).toContain("Pre-qualified → Qualified");
      expect(label).not.toContain("Riya Sharma");
    });
  });
});
