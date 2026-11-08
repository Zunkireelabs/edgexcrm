import { describe, expect, it } from "vitest";
import { masterViewExcludeIds, namedStageListIds } from "./master-exclusion";
import type { FilterTree } from "@/lib/filters/types";

const lists = [
  { id: "L-app", is_archive: false, is_staging: false },
  { id: "L-new", is_archive: false, is_staging: true }, // intake, staging
  { id: "L-arch", is_archive: true, is_staging: false },
];
const stage = (ids: string[], conjunction: "and" | "or" = "and"): FilterTree => ({ conjunction, conditions: [{ id: "c", field: "stage", op: "is_any_of", value: ids }] });
const everyone = () => true;

describe("masterViewExcludeIds", () => {
  it("no stage filter: today's hide (archive + staging)", () => {
    expect(masterViewExcludeIds(lists, null, everyone)).toEqual(["L-new", "L-arch"]);
    expect(masterViewExcludeIds(lists, { conjunction: "and", conditions: [] }, everyone)).toEqual(["L-new", "L-arch"]);
  });
  it("a named intake list is no longer hidden; unnamed ones stay hidden", () => {
    expect(masterViewExcludeIds(lists, stage(["L-app", "L-new"]), everyone)).toEqual(["L-arch"]);
  });
  it("a caller who may not see the named list still gets it hidden (e.g. a counsellor and an admin-only list)", () => {
    expect(masterViewExcludeIds(lists, stage(["L-new"]), (id) => id !== "L-new")).toEqual(["L-new", "L-arch"]);
  });
  it("only a top-level AND counts: OR groups and other operators change nothing", () => {
    expect(masterViewExcludeIds(lists, stage(["L-new"], "or"), everyone)).toEqual(["L-new", "L-arch"]);
    const isNot: FilterTree = { conjunction: "and", conditions: [{ id: "c", field: "stage", op: "is", value: "L-new" }] };
    expect(namedStageListIds(isNot)).toEqual([]);
    const nested: FilterTree = { conjunction: "and", conditions: [], groups: [{ conjunction: "and", conditions: [{ id: "c", field: "stage", op: "is_any_of", value: ["L-new"] }] }] };
    expect(namedStageListIds(nested)).toEqual([]);
  });
});
