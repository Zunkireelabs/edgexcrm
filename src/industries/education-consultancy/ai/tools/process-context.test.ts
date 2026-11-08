import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/logger", () => ({ logger: { error: vi.fn(), info: vi.fn(), warn: vi.fn() } }));
vi.mock("@/lib/api/audit", () => ({ createAuditLog: vi.fn(async () => undefined) }));
const { notesMock } = vi.hoisted(() => ({ notesMock: vi.fn() }));
vi.mock("../../features/home/server/lead-notes", () => ({ leadNotes: notesMock }));

import { buildBaselineSpec } from "../../features/processes/lib/baseline";
import { ADMIZZ_SETUP } from "../../features/processes/lib/fixtures";
import { fakeWorld } from "../../features/processes/server/improver/fake-db";
import { processForLead } from "../../features/processes/lib/improver/process-context";
import { processContextTool } from "./process-context";

const A = "tenant-a";
const B = "tenant-b";
const NEW = buildBaselineSpec("new_lead_first_call", ADMIZZ_SETUP);
const VISA = buildBaselineSpec("visa_to_enrolled", ADMIZZ_SETUP);

const rows = (over: Record<string, Array<Record<string, unknown>>> = {}) => ({
  leads: [
    { id: "lead-new", tenant_id: A, status: "new", pipeline_id: "pl", list_id: "L-new", deleted_at: null },
    { id: "lead-won", tenant_id: A, status: "visa", pipeline_id: "pl", list_id: "L-visa", deleted_at: null },
    { id: "lead-b", tenant_id: B, status: "new", pipeline_id: "pl", list_id: "L-b", deleted_at: null },
  ],
  lead_lists: [{ id: "L-new", tenant_id: A, slug: "pre-qualified" }, { id: "L-visa", tenant_id: A, slug: "visa-granted" }, { id: "L-enr", tenant_id: A, slug: "enrolled" }, { id: "L-b", tenant_id: B, slug: "pre-qualified" }],
  lead_activities: [],
  processes: [
    { id: "p1", tenant_id: A, key: "new_lead_first_call", name: "New lead → first call", live_version_id: "v1", owner_user_id: null },
    { id: "p2", tenant_id: A, key: "visa_to_enrolled", name: "Visa → Enrolled", live_version_id: "v2" },
    { id: "pb", tenant_id: B, key: "new_lead_first_call", name: "Tenant B process", live_version_id: "vb" },
  ],
  process_versions: [
    { id: "v1", tenant_id: A, process_id: "p1", version: 2, status: "live", spec: NEW, approved_at: "2026-11-07T00:00:00Z", approved_by: null },
    { id: "v2", tenant_id: A, process_id: "p2", version: 1, status: "live", spec: VISA, approved_at: "2026-11-07T00:00:00Z", approved_by: null },
    { id: "vb", tenant_id: B, process_id: "pb", version: 9, status: "live", spec: NEW, approved_at: "2026-11-07T00:00:00Z", approved_by: null },
  ],
  ...over,
});

function run(opts: { leadId: string; terminal?: string | null; tenant?: string; rowsOver?: Record<string, Array<Record<string, unknown>>>; subject?: boolean; worked?: boolean }) {
  const w = fakeWorld(opts.tenant ?? A, rows(opts.rowsOver), { education_lead_terminal: opts.terminal ?? null });
  notesMock.mockReturnValue({ eq: () => ({ is: () => Promise.resolve({ count: opts.worked ? 1 : 0 }) }) });
  const ctx = {
    auth: { actorType: "agent", agentId: "ag", tenantId: opts.tenant ?? A, industryId: "education_consultancy", positionId: null, permissions: {}, role: "agent" },
    db: w.db, logger: {}, runId: "r",
    ...(opts.subject ? { subjectType: "lead", subjectId: opts.leadId } : {}),
  };
  return { w, out: processContextTool.execute(ctx as never, opts.subject ? {} : { leadId: opts.leadId }) as Promise<Record<string, unknown>> };
}
const UUID = (id: string) => id; // the tool's schema wants uuids at the model boundary; execute() is called past it

beforeEach(() => vi.clearAllMocks());

describe("which process fits a lead", () => {
  it("a new or unworked open lead → New lead → first call; a won (visa granted) student not yet Enrolled → Visa → Enrolled; else none", () => {
    expect(processForLead({ terminal: null, listSlug: "pre-qualified", worked: false })).toBe("new_lead_first_call");
    expect(processForLead({ terminal: null, listSlug: "pre-qualified", worked: true })).toBeNull();
    expect(processForLead({ terminal: "won", listSlug: "visa-granted", worked: true })).toBe("visa_to_enrolled");
    expect(processForLead({ terminal: "won", listSlug: "enrolled", worked: true })).toBeNull();
    expect(processForLead({ terminal: "lost", listSlug: "archive", worked: false })).toBeNull();
  });
});

describe("process_context", () => {
  it("returns ONLY the fitting process: the new lead's live version with its SOP text, targets and the rules in words", async () => {
    const { out } = run({ leadId: UUID("lead-new") });
    const r = await out;
    expect(r.process).toMatchObject({ key: "new_lead_first_call", live: true, version: 2 });
    const steps = r.steps as Array<{ step: string; text: string; target: string }>;
    expect(steps.map((s) => s.step)).toContain("first_contact");
    expect(steps.every((s) => !s.text.includes("{target}") && !s.text.includes("**"))).toBe(true);
    expect((r.rules as string[]).some((l) => l.startsWith("First contact within"))).toBe(true);
    expect(String(r.instruction)).toMatch(/Never claim the process was followed/);
    expect(JSON.stringify(r)).not.toContain("Visa");
    expect(JSON.stringify(r)).not.toContain("Tenant B");
  });
  it("a visa-granted student gets Visa → Enrolled and nothing of the new-lead process", async () => {
    const { out } = run({ leadId: "lead-won", terminal: "won" });
    const r = await out;
    expect(r.process).toMatchObject({ key: "visa_to_enrolled", version: 1 });
    expect(r.rules).toBeNull();
    expect(JSON.stringify(r)).not.toContain("first call");
  });
  it("a lead no process fits (worked, open) gets none and is told not to invent one", async () => {
    const r = await run({ leadId: "lead-new", worked: true }).out;
    expect(r.process).toBeNull();
    expect(String(r.note)).toMatch(/Do not invent one/);
  });
  it("nothing for another tenant: a lead id of tenant B is not found, and no rpc is made for it", async () => {
    const { w, out } = run({ leadId: "lead-b" });
    expect(await out).toEqual({ error: "Lead not found." });
    expect(w.rpcs.filter((r) => r.name === "education_lead_terminal")).toEqual([]);
  });
  it("reads tenant B's process only for tenant B's own agent (never A's)", async () => {
    const r = await run({ leadId: "lead-b", tenant: B }).out;
    expect(r.process).toMatchObject({ version: 9 });
  });
  it("no live version: the new-lead process returns today's defaults, labelled as such; other processes return none", async () => {
    const noLive = { processes: [{ id: "p1", tenant_id: A, key: "new_lead_first_call", name: "x", live_version_id: null }, { id: "p2", tenant_id: A, key: "visa_to_enrolled", name: "y", live_version_id: null }] };
    const d = await run({ leadId: "lead-new", rowsOver: noLive }).out;
    expect(d.process).toMatchObject({ key: "new_lead_first_call", live: false });
    expect(String(d.note)).toMatch(/today's defaults/);
    expect((d.rules as string[])[0]).toBe("First contact within 1 hour.");
    const v = await run({ leadId: "lead-won", terminal: "won", rowsOver: noLive }).out;
    expect(v.process).toBeNull();
  });
  it("the lead comes from the run's own trigger subject, never from what the model passes", async () => {
    const w = fakeWorld(A, rows(), { education_lead_terminal: null });
    notesMock.mockReturnValue({ eq: () => ({ is: () => Promise.resolve({ count: 0 }) }) });
    const ctx = { auth: { actorType: "agent", agentId: "a", tenantId: A, industryId: "education_consultancy", positionId: null, permissions: {}, role: "agent" }, db: w.db, logger: {}, runId: "r", subjectType: "lead", subjectId: "lead-new" };
    const r = (await processContextTool.execute(ctx as never, { leadId: "lead-b" } as never)) as Record<string, unknown>;
    expect(r.process).toMatchObject({ key: "new_lead_first_call", version: 2 }); // tenant A's process, for A's lead
  });
  it("without a lead anywhere there is nothing to look up", async () => {
    const w = fakeWorld(A, rows());
    const ctx = { auth: { actorType: "agent", agentId: "a", tenantId: A, industryId: "education_consultancy", positionId: null, permissions: {}, role: "agent" }, db: w.db, logger: {}, runId: "r" };
    expect(await processContextTool.execute(ctx as never, {} as never)).toEqual({ error: "No lead to find a process for." });
  });
  it("is read-only, education-only and registered for the agents that act on leads", async () => {
    expect(processContextTool.scope).toBe("read");
    expect(processContextTool.industries).toEqual(["education_consultancy"]);
    await import("@/lib/ai/tools/packs");
    await import("@/lib/ai/agents/packs");
    const { getAgentDefinition } = await import("@/lib/ai/agents/registry");
    expect(getAgentDefinition("follow-up-drafter")!.toolIds).toContain("process_context");
    expect(getAgentDefinition("lead-triage")!.toolIds).toContain("process_context");
    const p = (k: string, industry: string | null) => getAgentDefinition(k)!.systemPrompt({ tenantId: "t", industryId: industry });
    expect(p("follow-up-drafter", "education_consultancy")).toMatch(/process_context[\s\S]*never claim the process was followed/i);
    expect(p("lead-triage", "education_consultancy")).toMatch(/process_context[\s\S]*never claim the process was followed/i);
    expect(p("lead-triage", "it_agency")).not.toMatch(/process_context/);
  });
});
