import { describe, expect, it } from "vitest";
import { getBulkBarActions, type BulkGateInput } from "./bulk-bar";
import { emptyVariant } from "./grid-empty-state";
import { countCounsellors } from "./leads-grid";
import { rowSignal } from "./v2-columns";
import type { Lead } from "@/types/database";

const base: BulkGateInput = {
  viewMode: "normal",
  isAdmin: true,
  isTeamScoped: false,
  selectedCount: 3,
  teamMemberCount: 5,
  isStagingView: false,
  hasOutreach: true,
  showBranches: true,
  branchCount: 2,
  canGraduate: false,
  hasArchiveList: true,
  pageFullySelected: false,
  pageCount: 25,
  effectiveTotal: 100,
  allResultsSelected: false,
};

describe("getBulkBarActions", () => {
  it("admin sees everything, with the rest under More", () => {
    const a = getBulkBarActions(base);
    expect(a).toMatchObject({ moveStage: true, assign: true, archive: true, restore: false });
    expect(a.more).toEqual(["enroll", "branch", "delete"]);
  });
  it("Merge appears only when exactly 2 are selected", () => {
    expect(getBulkBarActions({ ...base, selectedCount: 2 }).more).toContain("merge");
    expect(getBulkBarActions({ ...base, selectedCount: 3 }).more).not.toContain("merge");
  });
  it("counselor (neither admin nor team scoped) gets no write actions", () => {
    const a = getBulkBarActions({ ...base, isAdmin: false });
    expect(a).toMatchObject({ moveStage: false, assign: false, archive: false });
    expect(a.more).toEqual(["enroll"]);
  });
  it("team-scoped (branch manager) can move, assign, archive, delete but not branch/merge", () => {
    const a = getBulkBarActions({ ...base, isAdmin: false, isTeamScoped: true, selectedCount: 2 });
    expect(a).toMatchObject({ moveStage: true, assign: true, archive: true });
    expect(a.more).toEqual(["enroll", "delete"]);
  });
  it("hides More entries and Assign when their prerequisites are missing", () => {
    const a = getBulkBarActions({ ...base, hasOutreach: false, showBranches: false, teamMemberCount: 0, hasArchiveList: false });
    expect(a).toMatchObject({ assign: false, archive: false });
    expect(a.more).toEqual(["delete"]);
  });
  it("staging view hides enroll / branch / merge", () => {
    expect(getBulkBarActions({ ...base, isStagingView: true, selectedCount: 2 }).more).toEqual(["delete"]);
  });
  it("trash: Restore for admins, no Delete", () => {
    expect(getBulkBarActions({ ...base, viewMode: "trash" })).toMatchObject({ restore: true, deleteForever: false, moveStage: false, more: [] });
  });
  it("archived: Restore and Delete", () => {
    expect(getBulkBarActions({ ...base, viewMode: "archived" })).toMatchObject({ restore: true, deleteForever: true });
    expect(getBulkBarActions({ ...base, viewMode: "archived", isAdmin: false }).restore).toBe(false);
  });
  it("select-all offer only when the page is full and more rows match", () => {
    expect(getBulkBarActions({ ...base, pageFullySelected: true }).selection).toBe("select-all");
    expect(getBulkBarActions({ ...base, pageFullySelected: true, allResultsSelected: true }).selection).toBe("all-selected");
    expect(getBulkBarActions({ ...base, pageFullySelected: true, effectiveTotal: 25 }).selection).toBeNull();
    expect(getBulkBarActions({ ...base }).selection).toBeNull();
  });
});

describe("countCounsellors (footer)", () => {
  it("is blank (null) when the facet is not available", () => {
    expect(countCounsellors(null)).toBeNull();
    expect(countCounsellors(undefined)).toBeNull();
  });
  it("counts options with leads, excluding Unassigned and zero counts", () => {
    expect(countCounsellors([
      { name: "unassigned", count: 9 },
      { name: "a", count: 3 },
      { name: "b", count: 0 },
      { name: "c", count: 1 },
    ])).toBe(2);
  });
});

describe("emptyVariant", () => {
  it("filters win, with or without search", () => {
    expect(emptyVariant({ hasUserFilters: true, hasSearch: false, viewMode: "normal" })).toBe("filters");
    expect(emptyVariant({ hasUserFilters: true, hasSearch: true, viewMode: "trash" })).toBe("filters");
  });
  it("search only", () => {
    expect(emptyVariant({ hasUserFilters: false, hasSearch: true, viewMode: "normal" })).toBe("search");
  });
  it("trash and archived read Nothing here yet", () => {
    expect(emptyVariant({ hasUserFilters: false, hasSearch: false, viewMode: "trash" })).toBe("nothing");
    expect(emptyVariant({ hasUserFilters: false, hasSearch: false, viewMode: "archived" })).toBe("nothing");
  });
  it("otherwise No leads yet", () => {
    expect(emptyVariant({ hasUserFilters: false, hasSearch: false, viewMode: "normal" })).toBe("none");
  });
});

describe("rowSignal (Last activity cell)", () => {
  const ctx = { industryId: "education_consultancy", followUpStaleDays: 3 };
  const lead = (o: Partial<Lead>) => ({ on_hold: false, last_touched_at: new Date().toISOString(), callback_due_at: null, ...o }) as unknown as Lead;
  it("none for a recently touched lead", () => {
    expect(rowSignal(lead({}), ctx)).toBeNull();
  });
  it("follow-up needed uses the existing label", () => {
    expect(rowSignal(lead({ last_touched_at: null }), ctx)).toEqual({ tone: "warn", text: "Never touched" });
    const old = new Date(Date.now() - 9 * 86_400_000).toISOString();
    expect(rowSignal(lead({ last_touched_at: old }), ctx)).toEqual({ tone: "warn", text: "9d since touch" });
  });
  it("callback due wins over follow-up", () => {
    const due = new Date(Date.now() - 1000).toISOString();
    expect(rowSignal(lead({ last_touched_at: null, callback_due_at: due }), ctx)).toEqual({ tone: "bad", text: "Callback due" });
  });
  it("on hold suppresses follow-up but not callback", () => {
    expect(rowSignal(lead({ last_touched_at: null, on_hold: true }), ctx)).toBeNull();
  });
  it("other industries never signal", () => {
    expect(rowSignal(lead({ last_touched_at: null }), { industryId: "it_agency" })).toBeNull();
  });
});
