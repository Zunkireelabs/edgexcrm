import { describe, it, expect, vi, beforeEach } from "vitest";
import type { AuthContext } from "@/lib/api/auth";
import type { ResolvedPermissions } from "@/lib/api/permissions";
import type { LeadMembership } from "@/lib/leads/branch-membership";

const getLeadMembershipMock = vi.fn(async () => [] as LeadMembership);
const isLeadCollaboratorMock = vi.fn(async () => false);
const createAuditLogMock = vi.fn(async () => {});
const createNotificationsExceptMock = vi.fn(async () => {});

vi.mock("@/lib/leads/branch-membership", () => ({
  getLeadMembership: getLeadMembershipMock,
}));
vi.mock("@/lib/leads/collaborators", () => ({
  isLeadCollaborator: isLeadCollaboratorMock,
}));
vi.mock("@/lib/api/audit", () => ({
  createAuditLog: createAuditLogMock,
}));
vi.mock("@/lib/notifications", () => ({
  NotificationTypes: { NOTE_MENTION: "note.mention" },
  createNotificationsExcept: createNotificationsExceptMock,
}));
vi.mock("@/lib/logger", () => ({
  createRequestLogger: () => ({ info: vi.fn(), error: vi.fn() }),
}));

// ── Scripted fake supabase client ──────────────────────────────────────
interface FakeSupabaseOpts {
  lead: Record<string, unknown> | null;
  tenantUsers?: Record<string, { user_id: string; branch_id?: string }>;
  insertError?: { message: string } | null;
  authorMeta?: Record<string, unknown> | null;
}

function makeFakeSupabase(opts: FakeSupabaseOpts) {
  const insertedRows: Record<string, unknown>[] = [];

  function leadsBuilder() {
    const b = {
      select: () => b,
      eq: () => b,
      is: () => b,
      single: async () => ({ data: opts.lead, error: opts.lead ? null : { message: "not found" } }),
    };
    return b;
  }

  function tenantUsersBuilder() {
    const state: { userIds: string[]; branchId?: string } = { userIds: [] };
    const b = {
      select: () => b,
      eq: (col: string, val: unknown) => {
        if (col === "branch_id") state.branchId = val as string;
        return b;
      },
      in: (_col: string, vals: string[]) => {
        state.userIds = vals;
        return b;
      },
      then: (resolve: (v: { data: unknown; error: unknown }) => void) => {
        const rows = state.userIds
          .map((uid) => (opts.tenantUsers ?? {})[uid])
          .filter((r): r is { user_id: string; branch_id?: string } => !!r)
          .filter((r) => (state.branchId ? r.branch_id === state.branchId : true))
          .map((r) => ({ user_id: r.user_id }));
        resolve({ data: rows, error: null });
      },
    };
    return b;
  }

  function leadNotesBuilder() {
    let insertRow: Record<string, unknown> = {};
    const b = {
      insert: (row: Record<string, unknown>) => {
        insertRow = row;
        return b;
      },
      select: () => b,
      single: async () => {
        if (opts.insertError) return { data: null, error: opts.insertError };
        const note = { id: "note-1", ...insertRow };
        insertedRows.push(note);
        return { data: note, error: null };
      },
    };
    return b;
  }

  const db = {
    from: (table: string) => {
      if (table === "leads") return leadsBuilder();
      if (table === "tenant_users") return tenantUsersBuilder();
      if (table === "lead_notes") return leadNotesBuilder();
      throw new Error(`unexpected table ${table}`);
    },
    auth: {
      admin: {
        getUserById: async () => ({ data: { user: { user_metadata: opts.authorMeta ?? {} } } }),
      },
    },
  };

  return { db, insertedRows };
}

vi.mock("@/lib/supabase/server", () => ({
  createServiceClient: vi.fn(),
}));

async function withFakeDb(opts: FakeSupabaseOpts) {
  const { createServiceClient } = await import("@/lib/supabase/server");
  const { db, insertedRows } = makeFakeSupabase(opts);
  vi.mocked(createServiceClient).mockResolvedValue(db as never);
  return { insertedRows };
}

function fixtureAuth(overrides: Partial<AuthContext> = {}): AuthContext {
  return {
    userId: "user-1",
    email: "user1@example.com",
    tenantId: "tenant-1",
    role: "owner",
    industryId: "education_consultancy",
    positionId: null,
    positionSlug: null,
    branchId: null,
    branchMemberIds: [],
    permissions: { leadScope: "all" } as unknown as ResolvedPermissions,
    plan: "free",
    entitlements: {} as AuthContext["entitlements"],
    ...overrides,
  };
}

const OPTS = { requestId: "req-1" };

describe("createLeadNote", () => {
  beforeEach(() => {
    getLeadMembershipMock.mockReset().mockResolvedValue([]);
    isLeadCollaboratorMock.mockReset().mockResolvedValue(false);
    createAuditLogMock.mockReset();
    createNotificationsExceptMock.mockReset();
  });

  it("not_found when the lead doesn't exist", async () => {
    await withFakeDb({ lead: null });
    const { createLeadNote } = await import("./create-lead-note");
    const outcome = await createLeadNote(fixtureAuth(), "lead-1", { content: "hi" }, OPTS);
    expect(outcome.kind).toBe("not_found");
  });

  it("own-scope non-assignee is blocked -> not_found (no existence oracle)", async () => {
    await withFakeDb({ lead: { id: "lead-1", assigned_to: "other-user", branch_id: null, tags: [] } });
    const auth = fixtureAuth({ permissions: { leadScope: "own" } as unknown as ResolvedPermissions });
    const { createLeadNote } = await import("./create-lead-note");
    const outcome = await createLeadNote(auth, "lead-1", { content: "hi" }, OPTS);
    expect(outcome.kind).toBe("not_found");
  });

  it("walk-in isOwnBranchContact exception allows an own-scope non-assignee", async () => {
    await withFakeDb({ lead: { id: "lead-1", assigned_to: null, branch_id: "branch-1", tags: ["other"] } });
    const auth = fixtureAuth({
      branchId: "branch-1",
      permissions: { leadScope: "own" } as unknown as ResolvedPermissions,
    });
    const { createLeadNote } = await import("./create-lead-note");
    const outcome = await createLeadNote(auth, "lead-1", { content: "walk-in note" }, OPTS);
    expect(outcome.kind).toBe("ok");
  });

  it("a lead collaborator (own-scope, not the assignee) is allowed", async () => {
    await withFakeDb({ lead: { id: "lead-1", assigned_to: "other-user", branch_id: null, tags: [] } });
    isLeadCollaboratorMock.mockResolvedValue(true);
    const auth = fixtureAuth({ permissions: { leadScope: "own" } as unknown as ResolvedPermissions });
    const { createLeadNote } = await import("./create-lead-note");
    const outcome = await createLeadNote(auth, "lead-1", { content: "collab note" }, OPTS);
    expect(outcome.kind).toBe("ok");
  });

  it("team-scope branch manager outside the lead's branch is denied -> not_found", async () => {
    await withFakeDb({ lead: { id: "lead-1", assigned_to: null, branch_id: "branch-B", tags: [] } });
    const auth = fixtureAuth({
      branchId: "branch-A",
      branchMemberIds: [],
      permissions: { leadScope: "team" } as unknown as ResolvedPermissions,
    });
    const { createLeadNote } = await import("./create-lead-note");
    const outcome = await createLeadNote(auth, "lead-1", { content: "hi" }, OPTS);
    expect(outcome.kind).toBe("not_found");
  });

  it("empty/whitespace content -> validation", async () => {
    await withFakeDb({ lead: { id: "lead-1", assigned_to: "user-1", branch_id: null, tags: [] } });
    const { createLeadNote } = await import("./create-lead-note");
    const outcome = await createLeadNote(fixtureAuth(), "lead-1", { content: "   " }, OPTS);
    expect(outcome).toEqual({ kind: "validation", errors: { content: ["Note content is required"] } });
  });

  it("createdVia defaults to 'human' and ai_tool_call_id to null when omitted", async () => {
    const { insertedRows } = await withFakeDb({
      lead: { id: "lead-1", assigned_to: "user-1", branch_id: null, tags: [] },
    });
    const { createLeadNote } = await import("./create-lead-note");
    const outcome = await createLeadNote(fixtureAuth(), "lead-1", { content: "hi" }, OPTS);
    expect(outcome.kind).toBe("ok");
    expect(insertedRows[0]).toMatchObject({ created_via: "human", ai_tool_call_id: null });
  });

  it("carries an explicit createdVia:'ai_assistant' + aiToolCallId through to the insert", async () => {
    const { insertedRows } = await withFakeDb({
      lead: { id: "lead-1", assigned_to: "user-1", branch_id: null, tags: [] },
    });
    const { createLeadNote } = await import("./create-lead-note");
    await createLeadNote(
      fixtureAuth(),
      "lead-1",
      { content: "ai note", createdVia: "ai_assistant", aiToolCallId: "tc-123" },
      OPTS,
    );
    expect(insertedRows[0]).toMatchObject({ created_via: "ai_assistant", ai_tool_call_id: "tc-123" });
  });

  it("mention notifications are filtered to genuine tenant/branch members only", async () => {
    await withFakeDb({
      lead: { id: "lead-1", assigned_to: "user-1", branch_id: "branch-1", first_name: "Aisha", last_name: "Khan", tags: [] },
      tenantUsers: {
        "good-user": { user_id: "good-user", branch_id: "branch-1" },
        "wrong-branch-user": { user_id: "wrong-branch-user", branch_id: "branch-2" },
      },
    });
    const { createLeadNote } = await import("./create-lead-note");
    const outcome = await createLeadNote(
      fixtureAuth(),
      "lead-1",
      { content: "hi", mentionedUserIds: ["good-user", "wrong-branch-user", "not-a-member"] },
      OPTS,
    );
    expect(outcome.kind).toBe("ok");
    expect(createNotificationsExceptMock).toHaveBeenCalledTimes(1);
    const [, notifications] = createNotificationsExceptMock.mock.calls[0] as unknown as [unknown, Array<Record<string, unknown>>];
    expect(notifications).toHaveLength(1);
    expect(notifications[0]).toMatchObject({ userId: "good-user", type: "note.mention" });
  });

  it("no mention notifications sent when mentionedUserIds is omitted", async () => {
    await withFakeDb({ lead: { id: "lead-1", assigned_to: "user-1", branch_id: null, tags: [] } });
    const { createLeadNote } = await import("./create-lead-note");
    await createLeadNote(fixtureAuth(), "lead-1", { content: "hi" }, OPTS);
    expect(createNotificationsExceptMock).not.toHaveBeenCalled();
  });

  it("db_error outcome carries the underlying error", async () => {
    await withFakeDb({
      lead: { id: "lead-1", assigned_to: "user-1", branch_id: null, tags: [] },
      insertError: { message: "boom" },
    });
    const { createLeadNote } = await import("./create-lead-note");
    const outcome = await createLeadNote(fixtureAuth(), "lead-1", { content: "hi" }, OPTS);
    expect(outcome).toEqual({ kind: "db_error", error: { message: "boom" } });
  });

  it("records the lead.note_added audit log on success", async () => {
    await withFakeDb({ lead: { id: "lead-1", assigned_to: "user-1", branch_id: null, tags: [] } });
    const { createLeadNote } = await import("./create-lead-note");
    await createLeadNote(fixtureAuth(), "lead-1", { content: "hi" }, OPTS);
    expect(createAuditLogMock).toHaveBeenCalledTimes(1);
    const [auditInput] = createAuditLogMock.mock.calls[0] as unknown[];
    expect(auditInput).toMatchObject({
      action: "lead.note_added",
      entityType: "lead",
      entityId: "lead-1",
    });
  });
});
