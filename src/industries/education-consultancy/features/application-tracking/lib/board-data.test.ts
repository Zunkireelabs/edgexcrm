import { describe, expect, it } from "vitest";
import type { ApplicationStage } from "@/types/database";
import type { FilterTree } from "@/lib/filters/types";
import { assembleBoardTotals, isUnfilteredLoad, type BoardRow } from "./board-data";

const day = 86_400_000;
const now = Date.parse("2026-01-15T12:00:00.000Z");
const ago = (d: number) => new Date(now - d * day).toISOString();
const st = (id: string, pipeline_id: string | null, o: Partial<ApplicationStage> = {}) =>
  ({ id, pipeline_id, position: 0, is_default: false, is_terminal: false, terminal_type: null, ...o }) as ApplicationStage;
const stages = [st("a1", "pA", { is_default: true }), st("a2", "pA"), st("aDone", "pA", { is_terminal: true, terminal_type: "won" }), st("b1", "pB", { is_default: true })];
const pipelines = [{ id: "pA", is_default: true, position: 0 }, { id: "pB", is_default: false, position: 1 }];
const r = (id: string, o: Partial<BoardRow> = {}): BoardRow => ({
  id, stage_id: "a1", pipeline_id: "pA", stage_changed_at: ago(1), assigned_to: null, intake_term: null, countries: [], offer_type: null, leads: { assigned_to: null }, ...o,
});
const ROWS: BoardRow[] = [
  r("1", { assigned_to: "me", intake_term: "Fall 2026", countries: ["USA"], stage_changed_at: ago(40) }),
  r("2", { leads: { assigned_to: "me" }, intake_term: "Fall 2026", countries: ["usa", "Canada"], offer_type: "conditional" }),
  r("3", { stage_id: "a2", assigned_to: "x", intake_term: "Spring 2027", countries: ["🎓 UK"] }),
  r("4", { stage_id: "aDone", stage_changed_at: ago(90), countries: ["Canada"] }),
  r("5", { stage_id: "a1", pipeline_id: null, assigned_to: "x" }), // null pipeline -> placed under Default (pA)
  r("6", { stage_id: "b1", pipeline_id: "pB", assigned_to: "y", intake_term: "Fall 2027", countries: ["Germany"] }),
];
const base = { stages, pipelines, selectedPipelineId: "pA", userId: "me", nowMs: now };

describe("assembleBoardTotals (unfiltered numbers)", () => {
  const t = assembleBoardTotals({ ...base, lightRows: ROWS, mainRows: [ROWS[0]] });

  it("pipeline totals are unfiltered and use the Default placement (M1)", () => {
    expect(t.pipelineTotals).toEqual({ pA: 5, pB: 1 });
    expect(t.noPipelineTotal).toBe(1);
  });
  it("tab counts: All / My (effective counsellor) / Stuck excluding finished stages", () => {
    expect(t.tabCounts).toEqual({ all: 5, mine: 2, stuck: 1 });
  });
  it("facets come from the unfiltered rows of the SELECTED pipeline only (M2)", () => {
    expect(t.facets.counsellor).toEqual({ me: 2, x: 2 });
    expect(t.facets.intake).toEqual({ "Fall 2026": 2, "Spring 2027": 1 });
    expect(t.facets.offer_type).toEqual({ conditional: 1 });
    expect(t.facets.stage).toEqual({ a1: 3, a2: 1, aDone: 1 });
  });
  it("countries: one spelling per country (first seen), counted once per application", () => {
    expect(t.facets.country).toEqual({ USA: 2, Canada: 2, UK: 1 });
  });
  it("stage totals cover every pipeline", () => {
    expect(t.stageTotals).toEqual({ a1: 3, a2: 1, aDone: 1, b1: 1 });
  });
  it("the mainRows (filtered) never affect the totals when the light rows are in hand", () => {
    expect(assembleBoardTotals({ ...base, lightRows: ROWS, mainRows: [] })).toEqual(t);
  });
  it("selecting the other pipeline switches the facets, not the pipeline totals", () => {
    const b = assembleBoardTotals({ ...base, selectedPipelineId: "pB", lightRows: ROWS, mainRows: [] });
    expect(b.pipelineTotals).toEqual(t.pipelineTotals);
    expect(b.facets.country).toEqual({ Germany: 1 });
    expect(b.tabCounts).toEqual({ all: 1, mine: 0, stuck: 0 });
  });
});

describe("unfiltered read failed (B4)", () => {
  const t = assembleBoardTotals({ ...base, lightRows: null, mainRows: [ROWS[0], ROWS[1]] });
  it("tab counts become null (badges hide) instead of silent zeros", () => {
    expect(t.tabCounts).toBeNull();
    expect(t.degraded).toBe(true);
  });
  it("pipeline / option counts fall back to the rows in hand", () => {
    expect(t.pipelineTotals).toEqual({ pA: 2 });
    expect(t.facets.intake).toEqual({ "Fall 2026": 2 });
  });
});

describe("isUnfilteredLoad (M3: skip the light read)", () => {
  const empty: FilterTree = { conjunction: "and", conditions: [] };
  const chip: FilterTree = { conjunction: "and", conditions: [{ id: "c", field: "intake", op: "is", value: "x" }] };
  it("only no chips + no search + All tab", () => {
    expect(isUnfilteredLoad({ tree: empty, q: "", tab: "all" })).toBe(true);
    expect(isUnfilteredLoad({ tree: empty, q: "  ", tab: "all" })).toBe(true);
    expect(isUnfilteredLoad({ tree: chip, q: "", tab: "all" })).toBe(false);
    expect(isUnfilteredLoad({ tree: empty, q: "har", tab: "all" })).toBe(false);
    expect(isUnfilteredLoad({ tree: empty, q: "", tab: "mine" })).toBe(false);
    expect(isUnfilteredLoad({ tree: empty, q: "", tab: "stuck" })).toBe(false);
  });
  it("on an unfiltered load, totals from the main rows equal totals from a separate light read", () => {
    expect(assembleBoardTotals({ ...base, lightRows: ROWS, mainRows: ROWS })).toEqual(assembleBoardTotals({ ...base, lightRows: ROWS, mainRows: [] }));
  });
});
