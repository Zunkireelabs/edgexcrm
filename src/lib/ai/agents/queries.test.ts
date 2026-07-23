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

  it("computes acceptance rate over accepted+edited_accepted / non-expired outputs, and rolls up runs/position", async () => {
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
          ],
        },
        positions: { data: [{ id: "p1", name: "Sales Rep" }] },
      }),
    );
    const { getAgentFleet } = await import("./queries");

    const [item] = await getAgentFleet("tenant-1");

    expect(item.tasksCompleted).toBe(1); // only the 'completed' run counts
    expect(item.successRate).toBe(67); // 2 accepted / 3 non-expired, rounded
    expect(item.assignedRole).toBe("Sales Rep");
    expect(item.lastActive).toBe("2026-01-02T00:01:00Z"); // most recent activity across runs
  });
});

describe("getAgentCatalog", () => {
  it("excludes already-hired agent keys from the industry's catalog", async () => {
    getAgentDefinitionsForIndustryMock.mockReturnValue([
      { key: "lead-triage", name: "Lead Triage", description: "Scores leads" },
      { key: "follow-up-drafter", name: "Follow-up Drafter", description: "Drafts follow-ups" },
    ]);
    scopedClientForTenantMock.mockResolvedValue(fakeDb({ agent_identities: { data: [{ agent_key: "lead-triage" }] } }));
    const { getAgentCatalog } = await import("./queries");

    const catalog = await getAgentCatalog("tenant-1", "education_consultancy");

    expect(catalog.map((c) => c.key)).toEqual(["follow-up-drafter"]);
  });
});
