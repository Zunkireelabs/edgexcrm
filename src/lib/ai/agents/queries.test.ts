import { describe, it, expect, vi, beforeEach } from "vitest";

const scopedClientForTenantMock = vi.fn();
const getAgentDefinitionMock = vi.fn();
const getAgentDefinitionsForIndustryMock = vi.fn();

vi.mock("@/lib/supabase/scoped", () => ({ scopedClientForTenant: scopedClientForTenantMock }));
vi.mock("@/lib/ai/agents/packs", () => ({}));
vi.mock("./registry", () => ({
  getAgentDefinition: getAgentDefinitionMock,
  getAgentDefinitionsForIndustry: getAgentDefinitionsForIndustryMock,
}));

// A minimal stand-in for supabase-js's PostgrestFilterBuilder: every chain
// method (select/order/eq/in) returns itself, and it resolves via `.then()`
// (the thenable protocol `await` relies on) to a fixed per-table result —
// good enough since these tests don't need chain-argument-sensitive filtering.
function makeChain(result: { data: unknown; count?: number }) {
  const chain: Record<string, unknown> = {};
  const self = () => chain;
  chain.select = self;
  chain.order = self;
  chain.eq = self;
  chain.in = self;
  chain.limit = self;
  chain.or = self;
  // Unlike the no-op stubs above (existing tests already pass in
  // pre-filtered data, per the comment above), `.is()` has exactly one
  // caller in the codebase (getAgentDetail's undo_of exclusion) so it's
  // safe to give it real filtering semantics here without touching any
  // other test's fixtures.
  chain.is = (column: string, value: unknown) => {
    const data = Array.isArray(result.data)
      ? (result.data as Array<Record<string, unknown>>).filter((row) => row[column] === value)
      : result.data;
    return makeChain({ ...result, data });
  };
  chain.maybeSingle = () => Promise.resolve(result);
  chain.single = () => Promise.resolve(result);
  chain.then = (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) =>
    Promise.resolve(result).then(resolve, reject);
  return chain;
}

function fakeDb(tables: Record<string, { data: unknown; count?: number }>) {
  return { from: (table: string) => makeChain(tables[table] ?? { data: [] }) };
}

beforeEach(() => {
  scopedClientForTenantMock.mockReset();
  getAgentDefinitionMock.mockReset();
  getAgentDefinitionsForIndustryMock.mockReset();
});

describe("getAgentFleet", () => {
  it("returns [] when the tenant has no hired agents", async () => {
    scopedClientForTenantMock.mockResolvedValue(fakeDb({ agent_identities: { data: [] } }));
    const { getAgentFleet } = await import("./queries");

    expect(await getAgentFleet("tenant-1")).toEqual([]);
  });

  it("returns successRate null (never a fake 0%/100%) when the agent has zero outputs", async () => {
    getAgentDefinitionMock.mockReturnValue({ description: "Scores leads" });
    scopedClientForTenantMock.mockResolvedValue(
      fakeDb({
        agent_identities: {
          data: [
            {
              id: "a1",
              agent_key: "lead-triage",
              display_name: "Lead Triage",
              position_id: null,
              status: "active",
              created_at: "2026-01-01",
            },
          ],
        },
        agent_runs: { data: [] },
        agent_outputs: { data: [] },
        positions: { data: [] },
      }),
    );
    const { getAgentFleet } = await import("./queries");

    const [item] = await getAgentFleet("tenant-1");

    expect(item.successRate).toBeNull();
    expect(item.tasksCompleted).toBe(0);
    expect(item.lastActive).toBeNull();
    expect(item.assignedRole).toBe("Unassigned");
  });

  it("computes acceptance rate over accepted+edited_accepted / reviewed outputs (excludes expired+proposed), and rolls up runs/position", async () => {
    getAgentDefinitionMock.mockReturnValue({ description: "Scores leads" });
    scopedClientForTenantMock.mockResolvedValue(
      fakeDb({
        agent_identities: {
          data: [
            {
              id: "a1",
              agent_key: "lead-triage",
              display_name: "Lead Triage",
              position_id: "p1",
              status: "active",
              created_at: "2026-01-01",
            },
          ],
        },
        agent_runs: {
          data: [
            { agent_id: "a1", status: "completed", started_at: "2026-01-01T00:00:00Z", finished_at: "2026-01-01T00:05:00Z" },
            { agent_id: "a1", status: "failed", started_at: "2026-01-02T00:00:00Z", finished_at: "2026-01-02T00:01:00Z" },
          ],
        },
        agent_outputs: {
          data: [
            { agent_id: "a1", status: "accepted" },
            { agent_id: "a1", status: "edited_accepted" },
            { agent_id: "a1", status: "dismissed" },
            { agent_id: "a1", status: "expired" }, // excluded from the denominator entirely
            { agent_id: "a1", status: "proposed" }, // still unreviewed — excluded from the denominator too
          ],
        },
        positions: { data: [{ id: "p1", name: "Sales Rep" }] },
      }),
    );
    const { getAgentFleet } = await import("./queries");

    const [item] = await getAgentFleet("tenant-1");

    expect(item.tasksCompleted).toBe(1); // only the 'completed' run counts
    expect(item.successRate).toBe(67); // 2 accepted / 3 reviewed, rounded
    expect(item.assignedRole).toBe("Sales Rep");
    expect(item.lastActive).toBe("2026-01-02T00:01:00Z"); // most recent activity across runs
  });

  it("returns successRate null when an agent's outputs are all still 'proposed' (unreviewed)", async () => {
    getAgentDefinitionMock.mockReturnValue({ description: "Scores leads" });
    scopedClientForTenantMock.mockResolvedValue(
      fakeDb({
        agent_identities: {
          data: [
            {
              id: "a1",
              agent_key: "lead-triage",
              display_name: "Lead Triage",
              position_id: null,
              status: "active",
              created_at: "2026-01-01",
            },
          ],
        },
        agent_runs: { data: [] },
        agent_outputs: {
          data: [
            { agent_id: "a1", status: "proposed" },
            { agent_id: "a1", status: "proposed" },
          ],
        },
        positions: { data: [] },
      }),
    );
    const { getAgentFleet } = await import("./queries");

    const [item] = await getAgentFleet("tenant-1");

    expect(item.successRate).toBeNull();
  });
});

describe("getReviewQueue", () => {
  it("returns proposed rows enriched with agentName and lead subjectLabel", async () => {
    scopedClientForTenantMock.mockResolvedValue(
      fakeDb({
        agent_outputs: {
          data: [
            {
              id: "out-1",
              agent_id: "a1",
              kind: "score_suggestion",
              status: "proposed",
              subject_type: "lead",
              subject_id: "lead-1",
              payload: { score: 80, reasoning: "Strong fit" },
              created_at: "2026-01-02T00:00:00Z",
            },
            {
              id: "out-2",
              agent_id: "a1",
              kind: "task_suggestion",
              status: "proposed",
              subject_type: "lead",
              subject_id: "lead-2",
              payload: { title: "Follow up", description: null, dueDate: null },
              created_at: "2026-01-01T00:00:00Z",
            },
          ],
        },
        agent_identities: { data: [{ id: "a1", display_name: "Lead Triage" }] },
        leads: {
          data: [
            { id: "lead-1", first_name: "Ada", last_name: "Lovelace", email: "ada@example.com", display_id: "L-1" },
            { id: "lead-2", first_name: null, last_name: null, email: "no-name@example.com", display_id: "L-2" },
          ],
        },
      }),
    );
    const { getReviewQueue } = await import("./queries");

    const items = await getReviewQueue("tenant-1");

    expect(items).toHaveLength(2);
    expect(items[0]).toMatchObject({
      id: "out-1",
      agentName: "Lead Triage",
      subjectLabel: "Ada Lovelace",
    });
    expect(items[1]).toMatchObject({
      id: "out-2",
      agentName: "Lead Triage",
      subjectLabel: "no-name@example.com", // falls back to email when no name
    });
  });

  it("returns [] when there are no proposed outputs", async () => {
    scopedClientForTenantMock.mockResolvedValue(fakeDb({ agent_outputs: { data: [] } }));
    const { getReviewQueue } = await import("./queries");

    expect(await getReviewQueue("tenant-1")).toEqual([]);
  });

  it("excludes agent_human-tier write_action_proposal rows and includes human_led ones (Defect A, both directions)", async () => {
    scopedClientForTenantMock.mockResolvedValue(
      fakeDb({
        agent_outputs: {
          data: [
            {
              id: "out-agent-human",
              agent_id: "a1",
              kind: "write_action_proposal",
              status: "proposed",
              subject_type: null,
              subject_id: null,
              payload: { tool_id: "update_lead_stage", input: {}, automation_level: "agent_human" },
              created_at: "2026-01-02T00:00:00Z",
            },
            {
              id: "out-human-led",
              agent_id: "a1",
              kind: "write_action_proposal",
              status: "proposed",
              subject_type: null,
              subject_id: null,
              payload: { tool_id: "assign_lead", input: {}, automation_level: "human_led" },
              created_at: "2026-01-01T00:00:00Z",
            },
          ],
        },
        agent_identities: { data: [{ id: "a1", display_name: "Lead Triage" }] },
        leads: { data: [] },
      }),
    );
    const { getReviewQueue } = await import("./queries");

    const items = await getReviewQueue("tenant-1");

    // agent_human excluded (a real agent_approvals row drives it instead);
    // human_led kept (no approval row is ever created for it).
    expect(items.map((i) => i.id)).toEqual(["out-human-led"]);
  });
});

describe("getPendingApprovals", () => {
  it("returns pending approvals enriched with agent name and the run's subject", async () => {
    scopedClientForTenantMock.mockResolvedValue(
      fakeDb({
        agent_approvals: {
          data: [
            {
              id: "appr-1",
              run_id: "run-1",
              tool_id: "update_lead_stage",
              tool_input: { leadId: "lead-1", stageName: "Qualified" },
              requested_at: "2026-01-02T00:00:00Z",
              expires_at: "2026-01-04T00:00:00Z",
            },
          ],
        },
        agent_runs: { data: [{ id: "run-1", agent_id: "a1", subject_type: "lead", subject_id: "lead-1" }] },
        agent_identities: { data: [{ id: "a1", display_name: "Lead Triage" }] },
      }),
    );
    const { getPendingApprovals } = await import("./queries");

    const items = await getPendingApprovals("tenant-1");

    expect(items).toEqual([
      {
        id: "appr-1",
        toolId: "update_lead_stage",
        toolInput: { leadId: "lead-1", stageName: "Qualified" },
        runId: "run-1",
        agentId: "a1",
        agentName: "Lead Triage",
        subjectType: "lead",
        subjectId: "lead-1",
        requestedAt: "2026-01-02T00:00:00Z",
        expiresAt: "2026-01-04T00:00:00Z",
      },
    ]);
  });

  it("returns [] when there are no pending approvals", async () => {
    scopedClientForTenantMock.mockResolvedValue(fakeDb({ agent_approvals: { data: [] } }));
    const { getPendingApprovals } = await import("./queries");

    expect(await getPendingApprovals("tenant-1")).toEqual([]);
  });
});

describe("getPendingReviewCount", () => {
  it("sums pending suggestions and pending approvals", async () => {
    scopedClientForTenantMock.mockResolvedValue(
      fakeDb({
        agent_outputs: { data: [], count: 3 },
        agent_approvals: { data: [], count: 2 },
      }),
    );
    const { getPendingReviewCount } = await import("./queries");

    expect(await getPendingReviewCount("tenant-1")).toBe(5);
  });
});

describe("getAgentCatalog", () => {
  it("excludes already-hired agent keys from the industry's catalog", async () => {
    getAgentDefinitionsForIndustryMock.mockReturnValue([
      {
        key: "lead-triage",
        name: "Lead Triage",
        description: "Scores leads",
        triggers: [{ event: "crm/lead.created" }],
        toolIds: ["get_lead", "propose_score"],
        outputKinds: ["score_suggestion"],
      },
      {
        key: "follow-up-drafter",
        name: "Follow-up Drafter",
        description: "Drafts follow-ups",
        triggers: [{ event: "crm/lead.created" }],
        toolIds: ["get_lead", "propose_task"],
        outputKinds: ["task_suggestion"],
      },
    ]);
    scopedClientForTenantMock.mockResolvedValue(fakeDb({ agent_identities: { data: [{ agent_key: "lead-triage" }] } }));
    const { getAgentCatalog } = await import("./queries");

    const catalog = await getAgentCatalog("tenant-1", "education_consultancy");

    expect(catalog.map((c) => c.key)).toEqual(["follow-up-drafter"]);
    expect(catalog[0].capabilities.trigger).toBe("When a new lead is created");
    expect(catalog[0].capabilities.drafts).toEqual(["draft a follow-up task"]);
  });
});

describe("getAgentDetail", () => {
  it("returns null when the agent identity isn't in this tenant", async () => {
    scopedClientForTenantMock.mockResolvedValue(fakeDb({ agent_identities: { data: null } }));
    const { getAgentDetail } = await import("./queries");

    expect(await getAgentDetail("tenant-1", "missing-agent", null)).toBeNull();
  });

  it("rolls up lifetime stats over the full history and enriches the last-20 timeline with lead labels", async () => {
    getAgentDefinitionMock.mockReturnValue({
      key: "lead-triage",
      name: "Lead Triage",
      description: "Scores leads",
      triggers: [{ event: "crm/lead.created" }],
      toolIds: ["get_lead", "propose_score"],
      outputKinds: ["score_suggestion"],
    });
    scopedClientForTenantMock.mockResolvedValue(
      fakeDb({
        agent_identities: {
          data: {
            id: "a1",
            agent_key: "lead-triage",
            display_name: "Lead Triage",
            position_id: "p1",
            status: "active",
            created_at: "2026-01-01",
          },
        },
        positions: { data: { id: "p1", name: "Sales Rep" } },
        agent_runs: {
          data: [
            {
              id: "run-2",
              trigger_event: "crm/lead.created",
              subject_type: "lead",
              subject_id: "lead-1",
              status: "completed",
              usage: { duration_ms: 1200 },
              error: null,
              started_at: "2026-01-02T00:00:00Z",
              finished_at: "2026-01-02T00:00:01Z",
            },
            {
              id: "run-1",
              trigger_event: "crm/lead.created",
              subject_type: "lead",
              subject_id: "lead-2",
              status: "failed",
              usage: {},
              error: "boom",
              started_at: "2026-01-01T00:00:00Z",
              finished_at: "2026-01-01T00:00:01Z",
            },
          ],
        },
        agent_outputs: {
          data: [
            {
              id: "out-1",
              kind: "score_suggestion",
              status: "accepted",
              created_at: "2026-01-02T00:00:02Z",
              reviewed_at: "2026-01-02T00:01:00Z",
            },
            {
              id: "out-2",
              kind: "score_suggestion",
              status: "dismissed",
              created_at: "2026-01-01T00:00:02Z",
              reviewed_at: "2026-01-01T00:01:00Z",
            },
            {
              id: "out-3",
              kind: "score_suggestion",
              status: "proposed",
              created_at: "2026-01-03T00:00:02Z",
              reviewed_at: null,
            },
          ],
        },
        leads: {
          data: [
            { id: "lead-1", first_name: "Ada", last_name: "Lovelace", email: "ada@example.com", display_id: "L-1" },
            { id: "lead-2", first_name: null, last_name: null, email: "no-name@example.com", display_id: "L-2" },
          ],
        },
      }),
    );
    const { getAgentDetail } = await import("./queries");

    const detail = await getAgentDetail("tenant-1", "a1", "education_consultancy");

    expect(detail).not.toBeNull();
    expect(detail!.positionName).toBe("Sales Rep");
    expect(detail!.stats).toEqual({ tasksCompleted: 1, successRate: 50, lastActive: "2026-01-02T00:00:01Z" });
    expect(detail!.recentRuns).toHaveLength(2);
    expect(detail!.recentRuns[0]).toMatchObject({ id: "run-2", subjectLabel: "Ada Lovelace", durationMs: 1200 });
    expect(detail!.recentRuns[1]).toMatchObject({
      id: "run-1",
      subjectLabel: "no-name@example.com",
      error: "boom",
      durationMs: null,
    });
    expect(detail!.recentOutputs).toHaveLength(3);
    expect(detail!.capabilities?.trigger).toBe("When a new lead is created");
  });

  it("returns capabilities null (never throws) when the registry def is missing", async () => {
    getAgentDefinitionMock.mockReturnValue(undefined);
    scopedClientForTenantMock.mockResolvedValue(
      fakeDb({
        agent_identities: {
          data: {
            id: "a1",
            agent_key: "retired-agent",
            display_name: "Retired Agent",
            position_id: null,
            status: "paused",
            created_at: "2026-01-01",
          },
        },
        agent_runs: { data: [] },
        agent_outputs: { data: [] },
      }),
    );
    const { getAgentDetail } = await import("./queries");

    const detail = await getAgentDetail("tenant-1", "a1", "education_consultancy");

    expect(detail?.capabilities).toBeNull();
    expect(detail?.positionName).toBeNull();
    expect(detail?.stats).toEqual({ tasksCompleted: 0, successRate: null, lastActive: null });
  });

  it("excludes an undo row from recentWrites (undo_of set) while still marking the undone original's `undone` flag", async () => {
    getAgentDefinitionMock.mockReturnValue({
      key: "lead-triage",
      name: "Lead Triage",
      description: "Scores leads",
      triggers: [{ event: "crm/lead.created" }],
      toolIds: ["get_lead", "propose_score"],
      outputKinds: ["score_suggestion"],
    });
    scopedClientForTenantMock.mockResolvedValue(
      fakeDb({
        agent_identities: {
          data: {
            id: "a1",
            agent_key: "lead-triage",
            display_name: "Lead Triage",
            position_id: null,
            status: "active",
            created_at: "2026-01-01",
          },
        },
        agent_runs: { data: [] },
        agent_outputs: { data: [] },
        tenant_users: { data: [] },
        ai_write_actions: {
          data: [
            {
              id: "w-original",
              tool_id: "update_lead_stage",
              input: { leadId: "lead-1" },
              result: { stage: "Qualified", previous: { list_id: "old-list" } },
              status: "executed",
              user_id: "u1",
              created_at: "2026-01-01T00:00:00Z",
              undo_of: null,
            },
            {
              id: "w-undo",
              tool_id: "update_lead_stage",
              input: { leadId: "lead-1", patch: {} },
              result: { leadId: "lead-1", restored: {} },
              status: "executed",
              user_id: "u2",
              created_at: "2026-01-02T00:00:00Z",
              undo_of: "w-original",
            },
          ],
        },
      }),
    );
    const { getAgentDetail } = await import("./queries");

    const detail = await getAgentDetail("tenant-1", "a1", "education_consultancy");

    // Only the original action surfaces — the undo row itself (which would
    // otherwise render as a second, misleadingly-badged "Agent action" entry
    // with an Undo button that always 422s) is excluded.
    expect(detail!.recentWrites.map((w) => w.id)).toEqual(["w-original"]);
    expect(detail!.recentWrites[0].undone).toBe(true);
  });

  // Phase 6 slice 6.1 Part 2: writeToolIds must apply the same industry
  // predicate buildAgentToolset (runtime.ts) applies at execution time —
  // update_lead_stage is industries: [EDUCATION_CONSULTANCY]
  // (src/lib/ai/tools/universal/update-lead-stage.ts), so an it_agency
  // tenant's matrix must never offer a control for it.
  it("excludes an industry-gated write tool from toolPolicies when the tenant's industry doesn't match", async () => {
    getAgentDefinitionMock.mockReturnValue({
      key: "mcp-client",
      name: "External MCP Client",
      description: "test fixture",
      triggers: [],
      toolIds: ["get_lead", "update_lead_stage", "create_task"],
      outputKinds: ["write_action_proposal"],
    });
    scopedClientForTenantMock.mockResolvedValue(
      fakeDb({
        agent_identities: {
          data: {
            id: "a1",
            agent_key: "mcp-client",
            display_name: "External MCP Client",
            position_id: null,
            status: "active",
            created_at: "2026-01-01",
          },
        },
        agent_runs: { data: [] },
        agent_outputs: { data: [] },
        agent_tool_policies: { data: [] },
        ai_write_actions: { data: [] },
      }),
    );
    const { getAgentDetail } = await import("./queries");

    const detail = await getAgentDetail("tenant-1", "a1", "it_agency");

    const toolIds = detail!.toolPolicies.map((p) => p.toolId);
    expect(toolIds).toContain("create_task");
    expect(toolIds).not.toContain("update_lead_stage");
  });

  it("includes an industry-gated write tool in toolPolicies when the tenant's industry matches", async () => {
    getAgentDefinitionMock.mockReturnValue({
      key: "mcp-client",
      name: "External MCP Client",
      description: "test fixture",
      triggers: [],
      toolIds: ["get_lead", "update_lead_stage", "create_task"],
      outputKinds: ["write_action_proposal"],
    });
    scopedClientForTenantMock.mockResolvedValue(
      fakeDb({
        agent_identities: {
          data: {
            id: "a1",
            agent_key: "mcp-client",
            display_name: "External MCP Client",
            position_id: null,
            status: "active",
            created_at: "2026-01-01",
          },
        },
        agent_runs: { data: [] },
        agent_outputs: { data: [] },
        agent_tool_policies: { data: [] },
        ai_write_actions: { data: [] },
      }),
    );
    const { getAgentDetail } = await import("./queries");

    const detail = await getAgentDetail("tenant-1", "a1", "education_consultancy");

    expect(detail!.toolPolicies.map((p) => p.toolId)).toContain("update_lead_stage");
  });
});
