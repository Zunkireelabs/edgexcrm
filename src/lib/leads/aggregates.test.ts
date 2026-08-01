import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Lead, PipelineStage } from "@/types/database";
import { reshapeLeadAggregateRows, resolveSourceCounts, emptyAggregates, getLeadAggregates, getSourceFacet, listStatusKey } from "./aggregates";
import { resolveStageBucketCounts } from "@/components/dashboard/stats-cards";

const { rpcMock, createClientMock } = vi.hoisted(() => {
  const rpcMock = vi.fn();
  const createClientMock = vi.fn(() => Promise.resolve({ rpc: rpcMock }));
  return { rpcMock, createClientMock };
});
vi.mock("@/lib/supabase/server", () => ({ createClient: createClientMock }));

// Equivalence test (DASHBOARD-AGGREGATES-BRIEF.md §4.1): assert the new
// aggregate-based path produces the SAME numbers the OLD component logic produced
// over an identical fixture — per status, per stage, per source, per counselor, per
// week window. This is the safety net against "the numbers changed in a different
// wrong direction," which no amount of eyeballing prod/stage will catch.
//
// There is no live Postgres in the vitest environment, so `simulateAggregateRows`
// below is a JS mirror of migration 194's SELECT/GROUP BY statements, run in-memory
// over the same fixture the "old" oracle functions consume. The oracle functions
// (`oldStatsCardsCounts`, `oldLeadsByStageChart`, `oldLeadsBySourceChart`,
// `oldLeadsByCounselorChart`) are transcriptions of this repo's pre-migration
// component logic (git history: stats-cards.tsx / charts/*.tsx before this PR),
// not a re-derivation — they exist ONLY to give this test an independent oracle.

const NOW = new Date("2026-08-01T12:00:00.000Z");
const WEEK1_START = new Date(NOW.getTime() - 7 * 24 * 60 * 60 * 1000); // now - 7d
const WEEK2_START = new Date(NOW.getTime() - 14 * 24 * 60 * 60 * 1000); // now - 14d

const THIS_WEEK_TS = new Date(NOW.getTime() - 3 * 24 * 60 * 60 * 1000).toISOString(); // within last 7d
const LAST_WEEK_TS = new Date(NOW.getTime() - 10 * 24 * 60 * 60 * 1000).toISOString(); // 7-14d ago
const OLD_TS = new Date(NOW.getTime() - 60 * 24 * 60 * 60 * 1000).toISOString(); // > 14d ago

let idCounter = 0;
function makeLead(overrides: Partial<Lead>): Lead {
  idCounter += 1;
  const base: Lead = {
    id: `lead-${idCounter}`,
    tenant_id: "tenant-1",
    pipeline_id: "pipeline-1",
    session_id: null,
    step: 1,
    is_final: true,
    status: "new",
    first_name: "Test",
    last_name: "Lead",
    email: null,
    phone: null,
    city: null,
    country: null,
    custom_fields: {},
    file_urls: {},
    stage_id: null,
    assigned_to: null,
    entity_id: null,
    intake_source: null,
    intake_medium: null,
    intake_campaign: null,
    ref_code: null,
    form_source: null,
    preferred_contact_method: null,
    tags: [],
    lead_type: "lead",
    display_id: null,
    account_id: null,
    form_config_id: null,
    deleted_at: null,
    converted_at: null,
    converted_contact_id: null,
    idempotency_key: null,
    ai_score: null,
    ai_priority: null,
    ai_score_updated_at: null,
    normalized_email: null,
    merged_into: null,
    company_name: null,
    designation: null,
    prospect_industry: null,
    owner_id: null,
    salutation: null,
    company_email: null,
    branch_id: null,
    list_id: null,
    destinations: [],
    field_of_study: null,
    degree_level: null,
    nationality: null,
    intake_account: null,
    pre_app_fee_status: null,
    pre_app_fee_amount: null,
    pre_app_fee_notes: null,
    see_gpa: null,
    see_institution: null,
    see_passed_year: null,
    plus_two_gpa: null,
    plus_two_institution: null,
    plus_two_passed_year: null,
    bachelor_gpa: null,
    bachelor_institution: null,
    bachelor_passed_year: null,
    masters_gpa: null,
    masters_institution: null,
    masters_passed_year: null,
    ielts_score: null,
    pte_score: null,
    toefl_score: null,
    sat_score: null,
    gre_gmat_score: null,
    archive_reason: null,
    archived_by: null,
    archived_at: null,
    archived_from_list_id: null,
    archived_from_status: null,
    last_activity_at: THIS_WEEK_TS,
    created_at: THIS_WEEK_TS,
    updated_at: THIS_WEEK_TS,
  };
  return { ...base, ...overrides };
}

const STAGES: PipelineStage[] = [
  { id: "stage-new", tenant_id: "tenant-1", pipeline_id: "pipeline-1", name: "New", slug: "new", position: 0, color: "#000", is_default: true, is_terminal: false, terminal_type: null, created_at: "", updated_at: "" },
  { id: "stage-contacted", tenant_id: "tenant-1", pipeline_id: "pipeline-1", name: "Contacted", slug: "contacted", position: 1, color: "#000", is_default: false, is_terminal: false, terminal_type: null, created_at: "", updated_at: "" },
  { id: "stage-won", tenant_id: "tenant-1", pipeline_id: "pipeline-1", name: "Enrolled", slug: "enrolled", position: 2, color: "#000", is_default: false, is_terminal: true, terminal_type: "won", created_at: "", updated_at: "" },
  { id: "stage-lost", tenant_id: "tenant-1", pipeline_id: "pipeline-1", name: "Rejected", slug: "rejected", position: 3, color: "#000", is_default: false, is_terminal: true, terminal_type: "lost", created_at: "", updated_at: "" },
];

const FORM_MAP: Record<string, string> = { "form-a": "Website Form", "form-b": "Referral Form" };
const MEMBER_MAP: Record<string, string> = { "user-1": "alice@example.com", "user-2": "bob@example.com" };
const MEMBER_NAMES: Record<string, string> = { "user-1": "Alice" }; // user-2 has no display name -> falls back to memberMap

const FIXTURE: Lead[] = [
  // stage_id set, no fallback needed
  makeLead({ stage_id: "stage-new", status: "ignored-when-stage-id-set", created_at: THIS_WEEK_TS, assigned_to: "user-1", form_config_id: "form-a", intake_source: "utm-a" }),
  makeLead({ stage_id: "stage-contacted", status: "x", created_at: LAST_WEEK_TS, assigned_to: "user-2" }),
  makeLead({ stage_id: "stage-won", status: "x", created_at: OLD_TS, list_id: "list-1" }),
  makeLead({ stage_id: "stage-lost", status: "x", created_at: THIS_WEEK_TS }),
  // stage_id NULL -> fallback to status matching a stage slug
  makeLead({ stage_id: null, status: "new", created_at: THIS_WEEK_TS, list_id: "list-1" }),
  makeLead({ stage_id: null, status: "enrolled", created_at: LAST_WEEK_TS, assigned_to: "user-1" }),
  // stage_id NULL, status matches NO stage slug (counts toward total/status only)
  makeLead({ stage_id: null, status: "unmatched-status", created_at: OLD_TS }),
  // source resolution edge cases
  makeLead({ form_config_id: "form-a", intake_source: "should-be-ignored", stage_id: "stage-new" }),
  makeLead({ form_config_id: null, intake_source: "Direct Source", stage_id: "stage-new" }),
  makeLead({ form_config_id: "form-stale-not-in-map", intake_source: "fallback-intake-source", stage_id: "stage-new" }),
  makeLead({ form_config_id: null, intake_source: null, stage_id: "stage-new" }), // -> "Direct"
  // counselor: unassigned
  makeLead({ assigned_to: null, stage_id: "stage-new" }),
  // "other"-tagged contact — excluded when p_exclude_other_type is set
  makeLead({ tags: ["other"], stage_id: "stage-new", list_id: "list-2" }),
  // soft-deleted / converted — excluded unconditionally
  makeLead({ deleted_at: THIS_WEEK_TS, stage_id: "stage-new" }),
  makeLead({ converted_at: THIS_WEEK_TS, stage_id: "stage-new" }),
];

const VISIBLE = FIXTURE.filter((l) => l.deleted_at === null && l.converted_at === null);

// ── SQL mirror (migration 194) ──────────────────────────────────────────────
interface RawRow { dimension: string; key: string; bucket: string; cnt: number }

/** Which week-bucket a timestamp falls into, mirroring migration 194's
 * `created_at >= p_week1_start` / `>= p_week2_start AND < p_week1_start` WHERE clauses. */
function recencyOf(createdAt: string): "this_week" | "last_week" | "older" {
  const t = new Date(createdAt);
  if (t >= WEEK1_START) return "this_week";
  if (t >= WEEK2_START) return "last_week";
  return "older";
}

function simulateAggregateRows(leads: Lead[], excludeOtherType: boolean): RawRow[] {
  const visible = leads.filter(
    (l) => l.deleted_at === null && l.converted_at === null && (!excludeOtherType || !l.tags.includes("other")),
  );
  const rows: RawRow[] = [];
  const bump = (dimension: string, key: string, bucket: string) => {
    const existing = rows.find((r) => r.dimension === dimension && r.key === key && r.bucket === bucket);
    if (existing) existing.cnt += 1;
    else rows.push({ dimension, key, bucket, cnt: 1 });
  };

  for (const l of visible) {
    const statusKey = l.status?.trim() || "unknown";
    const recency = recencyOf(l.created_at);

    bump("status", statusKey, "all");
    if (recency === "this_week") bump("status", statusKey, "this_week");
    if (recency === "last_week") bump("status", statusKey, "last_week");

    if (l.stage_id) {
      bump("stage", l.stage_id, "all");
      if (recency === "this_week") bump("stage", l.stage_id, "this_week");
      if (recency === "last_week") bump("stage", l.stage_id, "last_week");
    } else {
      bump("stage_fallback_status", statusKey, "all");
      if (recency === "this_week") bump("stage_fallback_status", statusKey, "this_week");
      if (recency === "last_week") bump("stage_fallback_status", statusKey, "last_week");
    }

    const sourceKey = `${l.form_config_id ?? ""}\x1f${l.intake_source ?? ""}`;
    bump("source_combo", sourceKey, "all");

    bump("counselor", l.assigned_to ?? "(unassigned)", "all");
    bump("list", l.list_id ?? "(none)", "all");
    bump("list_status", `${l.list_id ?? "(none)"}\x1f${statusKey}`, "all");

    // ADDENDUM: /leads Source facet dimensions
    const intakeSource = l.intake_source?.trim();
    if (intakeSource) {
      bump("intake_source", intakeSource, "all");
      for (const part of intakeSource.split(" | ")) {
        const trimmed = part.trim();
        if (trimmed) bump("intake_source_part", trimmed, "all");
      }
    }
  }
  return rows;
}

// ── "Old" oracles — pre-migration component logic, transcribed for independent comparison ──
function matchesStage(lead: Lead, stage: PipelineStage): boolean {
  if (lead.stage_id) return lead.stage_id === stage.id;
  return lead.status === stage.slug;
}
function leadsInStages(leads: Lead[], stages: PipelineStage[]): Lead[] {
  return leads.filter((l) => stages.some((s) => matchesStage(l, s)));
}
function filterByWeek(leads: Lead[], from: Date, to: Date): number {
  return leads.filter((l) => { const t = new Date(l.created_at); return t >= from && t < to; }).length;
}
function oldStatsCardsCounts(leads: Lead[], stages: PipelineStage[]) {
  const sorted = [...stages].sort((a, b) => a.position - b.position);
  const defaultStage = sorted.find((s) => s.is_default) ?? sorted[0];
  const wonStages = sorted.filter((s) => s.is_terminal && s.terminal_type === "won");
  const lostStages = sorted.filter((s) => s.is_terminal && s.terminal_type === "lost");
  const inProgressStages = sorted.filter((s) => !s.is_terminal && s.id !== defaultStage?.id);

  const newLeads = defaultStage ? leadsInStages(leads, [defaultStage]) : [];
  const inProgressLeads = leadsInStages(leads, inProgressStages);
  const wonLeads = leadsInStages(leads, wonStages);
  const lostLeads = leadsInStages(leads, lostStages);

  return {
    total: { all: leads.length, thisWeek: filterByWeek(leads, WEEK1_START, NOW), lastWeek: filterByWeek(leads, WEEK2_START, WEEK1_START) },
    new: { all: newLeads.length, thisWeek: filterByWeek(newLeads, WEEK1_START, NOW), lastWeek: filterByWeek(newLeads, WEEK2_START, WEEK1_START) },
    inProgress: { all: inProgressLeads.length, thisWeek: filterByWeek(inProgressLeads, WEEK1_START, NOW), lastWeek: filterByWeek(inProgressLeads, WEEK2_START, WEEK1_START) },
    won: { all: wonLeads.length, thisWeek: filterByWeek(wonLeads, WEEK1_START, NOW), lastWeek: filterByWeek(wonLeads, WEEK2_START, WEEK1_START) },
    lost: { all: lostLeads.length, thisWeek: filterByWeek(lostLeads, WEEK1_START, NOW), lastWeek: filterByWeek(lostLeads, WEEK2_START, WEEK1_START) },
  };
}
function oldLeadsByStageChart(leads: Lead[]): Record<string, number> {
  return leads.reduce((acc, lead) => {
    const status = lead.status || "unknown";
    acc[status] = (acc[status] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);
}
function oldLeadsBySourceChart(leads: Lead[], formMap: Record<string, string>): Record<string, number> {
  return leads.reduce((acc, lead) => {
    const sourceId = lead.form_config_id || "unknown";
    const sourceName = formMap[sourceId] || lead.intake_source || "Direct";
    acc[sourceName] = (acc[sourceName] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);
}
function oldLeadsByCounselorChart(leads: Lead[], memberMap: Record<string, string>, memberNames: Record<string, string>): Record<string, number> {
  return leads.reduce((acc, lead) => {
    const assignedTo = lead.assigned_to;
    const counselorName = assignedTo ? memberNames[assignedTo] || memberMap[assignedTo]?.split("@")[0] || "Unknown" : "Unassigned";
    acc[counselorName] = (acc[counselorName] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);
}

describe("lead_aggregates equivalence (dashboard, no other-type exclusion)", () => {
  const rows = simulateAggregateRows(FIXTURE, false);
  const aggregates = reshapeLeadAggregateRows(rows);
  const visible = VISIBLE; // deleted/converted already excluded; "other" tag NOT excluded here

  it("total matches leads.length over the visible fixture", () => {
    expect(aggregates.total).toBe(visible.length);
  });

  it("status dimension matches raw status grouping (LeadsByStageChart)", () => {
    const oldCounts = oldLeadsByStageChart(visible);
    const newCounts: Record<string, number> = {};
    for (const [key, bucket] of Object.entries(aggregates.status)) if (bucket.all > 0) newCounts[key] = bucket.all;
    expect(newCounts).toEqual(oldCounts);
  });

  it("stage-driven StatsCards counts (matchesStage dispatch) match old component logic, incl. this/last week", () => {
    const oldCounts = oldStatsCardsCounts(visible, STAGES);
    const sorted = [...STAGES].sort((a, b) => a.position - b.position);
    const defaultStage = sorted.find((s) => s.is_default)!;
    const wonStages = sorted.filter((s) => s.is_terminal && s.terminal_type === "won");
    const lostStages = sorted.filter((s) => s.is_terminal && s.terminal_type === "lost");
    const inProgressStages = sorted.filter((s) => !s.is_terminal && s.id !== defaultStage.id);

    const sumBuckets = (list: ReturnType<typeof resolveStageBucketCounts>[]) =>
      list.reduce((acc, b) => ({ all: acc.all + b.all, thisWeek: acc.thisWeek + b.thisWeek, lastWeek: acc.lastWeek + b.lastWeek }), { all: 0, thisWeek: 0, lastWeek: 0 });

    const newBucket = resolveStageBucketCounts(aggregates.stage, aggregates.stageFallbackStatus, defaultStage);
    const inProgressBucket = sumBuckets(inProgressStages.map((s) => resolveStageBucketCounts(aggregates.stage, aggregates.stageFallbackStatus, s)));
    const wonBucket = sumBuckets(wonStages.map((s) => resolveStageBucketCounts(aggregates.stage, aggregates.stageFallbackStatus, s)));
    const lostBucket = sumBuckets(lostStages.map((s) => resolveStageBucketCounts(aggregates.stage, aggregates.stageFallbackStatus, s)));
    const totalBucket = Object.values(aggregates.status).reduce((acc, b) => ({ all: acc.all + b.all, thisWeek: acc.thisWeek + b.thisWeek, lastWeek: acc.lastWeek + b.lastWeek }), { all: 0, thisWeek: 0, lastWeek: 0 });

    expect(totalBucket).toEqual(oldCounts.total);
    expect(newBucket).toEqual(oldCounts.new);
    expect(inProgressBucket).toEqual(oldCounts.inProgress);
    expect(wonBucket).toEqual(oldCounts.won);
    expect(lostBucket).toEqual(oldCounts.lost);
  });

  it("source resolution (form_config_id -> formMap, else intake_source, else Direct) matches old chart logic, incl. stale-form-id edge case", () => {
    const oldCounts = oldLeadsBySourceChart(visible, FORM_MAP);
    const newCounts = resolveSourceCounts(aggregates.sourceCombos, FORM_MAP);
    expect(newCounts).toEqual(oldCounts);
  });

  it("counselor resolution matches old chart logic, incl. unassigned and missing-display-name fallback", () => {
    const oldCounts = oldLeadsByCounselorChart(visible, MEMBER_MAP, MEMBER_NAMES);
    const newCounts: Record<string, number> = {};
    for (const [assignedTo, count] of Object.entries(aggregates.counselor)) {
      const name = assignedTo !== "(unassigned)" ? MEMBER_NAMES[assignedTo] || MEMBER_MAP[assignedTo]?.split("@")[0] || "Unknown" : "Unassigned";
      newCounts[name] = (newCounts[name] ?? 0) + count;
    }
    expect(newCounts).toEqual(oldCounts);
  });

  it("list dimension matches a plain group-by-list_id count", () => {
    const oldCounts: Record<string, number> = {};
    for (const l of visible) {
      const key = l.list_id ?? "(none)";
      oldCounts[key] = (oldCounts[key] ?? 0) + 1;
    }
    expect(aggregates.list).toEqual(oldCounts);
  });

  it("listStatuses derives the distinct-status set per list from the fixture, not a loaded page", () => {
    const oldStatusesPerList: Record<string, Set<string>> = {};
    for (const l of visible) {
      const key = l.list_id ?? "(none)";
      const status = l.status?.trim() || "unknown";
      (oldStatusesPerList[key] ??= new Set()).add(status);
    }
    for (const [listId, set] of Object.entries(oldStatusesPerList)) {
      expect(aggregates.listStatuses[listId]).toEqual([...set].sort());
    }
  });

  // KANBAN-PAGINATION-BRIEF §2b: ListKanbanView's per-column (per-status) header
  // count comes from this map, never from cards.length — must be an exact count,
  // not just the "does this status exist" boolean listStatuses gives.
  it("listStatusCounts gives an exact per-(list,status) count, keyed by listStatusKey", () => {
    const oldCounts: Record<string, number> = {};
    for (const l of visible) {
      const key = listStatusKey(l.list_id ?? "(none)", l.status?.trim() || "unknown");
      oldCounts[key] = (oldCounts[key] ?? 0) + 1;
    }
    expect(aggregates.listStatusCounts).toEqual(oldCounts);
  });
});

describe("lead_aggregates equivalence (pipeline, education excludeOtherType=true)", () => {
  it("excludes 'other'-tagged contacts from every dimension, matching getLeads(excludeOtherType)", () => {
    const rows = simulateAggregateRows(FIXTURE, true);
    const aggregates = reshapeLeadAggregateRows(rows);
    const visibleNoOther = VISIBLE.filter((l) => !l.tags.includes("other"));

    const oldListCounts: Record<string, number> = {};
    for (const l of visibleNoOther) {
      const key = l.list_id ?? "(none)";
      oldListCounts[key] = (oldListCounts[key] ?? 0) + 1;
    }
    expect(aggregates.list).toEqual(oldListCounts);
    expect(aggregates.total).toBe(visibleNoOther.length);
  });
});

describe("/leads source facet invariant (ADDENDUM §\"the invariant that makes this testable\")", () => {
  // "The count shown beside a facet option must equal the total the page reports
  // when you select that option." /api/v1/leads always excludes "other"-tagged
  // contacts (route.ts line ~302), so the facet is computed the same way here.
  const rows = simulateAggregateRows(FIXTURE, true);
  const visibleNoOther = VISIBLE.filter((l) => !l.tags.includes("other"));
  const intakeSourceRows = rows.filter((r) => r.dimension === "intake_source");

  it("has at least one option (sanity — the fixture has non-empty intake_source rows)", () => {
    expect(intakeSourceRows.length).toBeGreaterThan(0);
  });

  it("each option's count equals selecting that exact intake_source as the only added filter", () => {
    for (const row of intakeSourceRows) {
      const selectedCount = visibleNoOther.filter((l) => l.intake_source === row.key).length;
      expect(row.cnt).toBe(selectedCount);
    }
  });

  it("never offers a blank/whitespace-only intake_source as an option", () => {
    expect(intakeSourceRows.every((r) => r.key.trim().length > 0)).toBe(true);
  });
});

describe("getLeadAggregates — restricted-but-empty pipeline allowlist (review fix)", () => {
  beforeEach(() => {
    rpcMock.mockReset();
    createClientMock.mockClear();
    rpcMock.mockResolvedValue({ data: [], error: null });
  });

  it("scope.pipelineIds: [] (leadQueryScope's restricted-but-empty shape) yields zeroed aggregates and makes zero RPC calls", async () => {
    const result = await getLeadAggregates("tenant-1", { pipelineIds: [] }, NOW);
    expect(result).toEqual(emptyAggregates());
    expect(rpcMock).not.toHaveBeenCalled();
  });

  it("scope.pipelineIds: null (unrestricted) still calls the RPC normally", async () => {
    await getLeadAggregates("tenant-1", { pipelineIds: null }, NOW);
    expect(rpcMock).toHaveBeenCalledTimes(1);
    const [name, params] = rpcMock.mock.calls[0];
    expect(name).toBe("lead_aggregates");
    expect(params).not.toHaveProperty("p_pipeline_ids");
  });

  it("scope.pipelineIds: undefined (no scope) still calls the RPC normally", async () => {
    await getLeadAggregates("tenant-1", undefined, NOW);
    expect(rpcMock).toHaveBeenCalledTimes(1);
  });

  it("a non-empty allowlist still calls the RPC with p_pipeline_ids set", async () => {
    await getLeadAggregates("tenant-1", { pipelineIds: ["pipeline-1"] }, NOW);
    expect(rpcMock).toHaveBeenCalledTimes(1);
    const [, params] = rpcMock.mock.calls[0];
    expect(params).toMatchObject({ p_pipeline_ids: ["pipeline-1"] });
  });

  // KANBAN-PAGINATION-BRIEF §2b/§3.1: ListKanbanView/FunnelKanbanBoard scope the
  // aggregate to one list (listIdEq) or a funnel's stage-lists (listIdAny) so every
  // dimension in the response — not just `list`/`list_status` — is list-scoped.
  it("scope.listIdEq is passed through as p_list_id_eq", async () => {
    await getLeadAggregates("tenant-1", { listIdEq: "list-1" }, NOW);
    const [, params] = rpcMock.mock.calls[0];
    expect(params).toMatchObject({ p_list_id_eq: "list-1" });
  });

  it("scope.listIdAny is passed through as p_list_id_any", async () => {
    await getLeadAggregates("tenant-1", { listIdAny: ["list-1", "list-2"] }, NOW);
    const [, params] = rpcMock.mock.calls[0];
    expect(params).toMatchObject({ p_list_id_any: ["list-1", "list-2"] });
  });

  it("omits p_list_id_eq / p_list_id_any when neither is set — existing (non-Kanban) callers untouched", async () => {
    await getLeadAggregates("tenant-1", { branchId: "branch-1" }, NOW);
    const [, params] = rpcMock.mock.calls[0];
    expect(params).not.toHaveProperty("p_list_id_eq");
    expect(params).not.toHaveProperty("p_list_id_any");
  });
});

describe("getLeadAggregates / getSourceFacet — RPC failure fails loudly, never renders zeros", () => {
  beforeEach(() => {
    rpcMock.mockReset();
    createClientMock.mockClear();
  });

  it("getLeadAggregates throws (not zeroed aggregates) when the RPC errors", async () => {
    rpcMock.mockResolvedValue({ data: null, error: { message: "connection refused" } });
    await expect(getLeadAggregates("tenant-1", undefined, NOW)).rejects.toThrow(
      /lead_aggregates RPC failed for tenant tenant-1/,
    );
  });

  it("getSourceFacet throws (not an empty option list) when the RPC errors", async () => {
    rpcMock.mockResolvedValue({ data: null, error: { message: "connection refused" } });
    await expect(getSourceFacet({ tenantId: "tenant-1", scope: "all" })).rejects.toThrow(
      /lead_aggregates source facet failed for tenant tenant-1/,
    );
  });

  it("a restricted-but-empty pipeline allowlist still short-circuits without calling the RPC (not a failure path)", async () => {
    const result = await getLeadAggregates("tenant-1", { pipelineIds: [] }, NOW);
    expect(result).toEqual(emptyAggregates());
    expect(rpcMock).not.toHaveBeenCalled();
  });
});
