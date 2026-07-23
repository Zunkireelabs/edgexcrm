import { describe, it, expect, vi, beforeEach } from "vitest";

const scopedClientForTenantMock = vi.fn();
const getAgentDefinitionMock = vi.fn();
const getAgentDefinitionsForIndustryMock = vi.fn();

vi.mock("@/lib/supabase/scoped", () => ({ scopedClientForTenant: scopedClientForTenantMock }));
vi.mock("./registry", () => ({
  getAgentDefinition: getAgentDefinitionMock,
  getAgentDefinitionsForIndustry: getAgentDefinitionsForIndustryMock,
}));

// A minimal stand-in for supabase-js's PostgrestFilterBuilder: every chain
// method (select/order/eq/in) returns itself, and it resolves via `.then()`
// (the thenable protocol `await` relies on) to a fixed per-table result —
// good enough since these tests don't need chain-argument-sensitive filtering.
function makeChain(result: { data: unknown }) {
  const chain: Record<string, unknown> = {};
  const self = () => chain;
  chain.select = self;
  chain.order = self;
  chain.eq = self;
  chain.in = self;
  chain.maybeSingle = () => Promise.resolve(result);
  chain.single = () => Promise.resolve(result);
  chain.then = (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) =>
    Promise.resolve(result).then(resolve, reject);
  return chain;
}

function fakeDb(tables: Record<string, { data: unknown }>) {
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

    expect(await getAgentDetail("tenant-1", "missing-agent")).toBeNull();
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

    const detail = await getAgentDetail("tenant-1", "a1");

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

    const detail = await getAgentDetail("tenant-1", "a1");

    expect(detail?.capabilities).toBeNull();
    expect(detail?.positionName).toBeNull();
    expect(detail?.stats).toEqual({ tasksCompleted: 0, successRate: null, lastActive: null });
  });
});
