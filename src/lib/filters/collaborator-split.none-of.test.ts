import { describe, it, expect } from "vitest";
import { splitCollaboratorNoneOf } from "./collaborator-split";
import type { FilterTree, FilterCondition } from "./types";

const A = "11111111-2222-4333-8444-555555555555";
const B = "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee";

const cond = (id: string, field: string, op: FilterCondition["op"], value?: unknown): FilterCondition =>
  ({ id, field, op, ...(value !== undefined ? { value } : {}) }) as FilterCondition;
const and = (...conditions: FilterCondition[]): FilterTree => ({ conjunction: "and", conditions, groups: [] }) as FilterTree;
const or = (...conditions: FilterCondition[]): FilterTree => ({ conjunction: "or", conditions, groups: [] }) as FilterTree;

describe("splitCollaboratorNoneOf", () => {
  it("lifts a single top-level is_none_of and leaves the rest of the tree", () => {
    const status = cond("s", "status", "is", "new");
    const r = splitCollaboratorNoneOf(and(status, cond("c", "collaborators", "is_none_of", [A, B])));
    expect(r.excludeIds).toEqual([A, B]);
    expect(r.includeIds).toBeNull();
    expect(r.rest.conditions).toEqual([status]);
  });

  it("lifts an accompanying single is_any_of as the include list", () => {
    const r = splitCollaboratorNoneOf(and(cond("a", "collaborators", "is_any_of", [A]), cond("c", "collaborators", "is_none_of", [B])));
    expect(r.excludeIds).toEqual([B]);
    expect(r.includeIds).toEqual([A]);
    expect(r.rest.conditions).toEqual([]);
  });

  it("is_empty alongside stays in the tree (it reads a plain column, not an embed)", () => {
    const empty = cond("e", "collaborators", "is_empty");
    const r = splitCollaboratorNoneOf(and(empty, cond("c", "collaborators", "is_none_of", [A])));
    expect(r.excludeIds).toEqual([A]);
    expect(r.rest.conditions).toEqual([empty]);
  });

  it("does NOT lift when nothing is excluded (an any_of alone is the existing path)", () => {
    const t = and(cond("a", "collaborators", "is_any_of", [A]));
    expect(splitCollaboratorNoneOf(t)).toEqual({ excludeIds: null, includeIds: null, rest: t });
  });

  it.each([
    ["an OR tree", or(cond("c", "collaborators", "is_none_of", [A]), cond("s", "status", "is", "new"))],
    ["two none_of conditions", and(cond("c1", "collaborators", "is_none_of", [A]), cond("c2", "collaborators", "is_none_of", [B]))],
    ["two any_of conditions beside it (one would stay behind as an embed)", and(cond("a1", "collaborators", "is_any_of", [A]), cond("a2", "collaborators", "is_any_of", [B]), cond("c", "collaborators", "is_none_of", [B]))],
    ["is_not_empty beside it (an embed filter would stay behind)", and(cond("n", "collaborators", "is_not_empty"), cond("c", "collaborators", "is_none_of", [A]))],
    ["a malformed uuid in none_of", and(cond("c", "collaborators", "is_none_of", [A, "not-a-uuid"]))],
    ["an empty none_of list", and(cond("c", "collaborators", "is_none_of", []))],
    ["a malformed any_of beside a valid none_of", and(cond("a", "collaborators", "is_any_of", ["nope"]), cond("c", "collaborators", "is_none_of", [A]))],
  ])("returns the tree untouched for %s", (_name, tree) => {
    expect(splitCollaboratorNoneOf(tree)).toEqual({ excludeIds: null, includeIds: null, rest: tree });
  });

  it("ignores none_of on other fields", () => {
    const t = and(cond("s", "status", "is_none_of", ["won"]));
    expect(splitCollaboratorNoneOf(t).excludeIds).toBeNull();
  });
});
