import { describe, it, expect } from "vitest";
import { splitCollaboratorAnyOf } from "./collaborator-split";
import type { FilterCondition, FilterTree } from "./types";

const A = "11111111-1111-1111-1111-111111111111";
const B = "22222222-2222-2222-2222-222222222222";

const collab = (value: unknown, op: FilterCondition["op"] = "is_any_of", id = "c1"): FilterCondition =>
  ({ id, field: "collaborators", op, value } as FilterCondition);
const status = (id = "s1"): FilterCondition => ({ id, field: "status", op: "is", value: "new" });
const tree = (conjunction: "and" | "or", conditions: FilterCondition[], groups?: FilterTree["groups"]): FilterTree =>
  ({ conjunction, conditions, ...(groups ? { groups } : {}) });

describe("splitCollaboratorAnyOf", () => {
  it("lifts a top-level 'is any of' out of an AND tree and keeps every other condition", () => {
    const t = tree("and", [status(), collab([A, B])]);
    const out = splitCollaboratorAnyOf(t);
    expect(out.collaboratorIds).toEqual([A, B]);
    expect(out.rest.conditions.map((c) => c.id)).toEqual(["s1"]);
    expect(out.rest.conjunction).toBe("and");
  });

  it("keeps sub-groups untouched", () => {
    const groups = [{ conjunction: "or" as const, conditions: [status("g1"), status("g2")] }];
    const out = splitCollaboratorAnyOf(tree("and", [collab([A])], groups));
    expect(out.collaboratorIds).toEqual([A]);
    expect(out.rest.groups).toBe(groups);
    expect(out.rest.conditions).toEqual([]);
  });

  it("does not mutate the input tree", () => {
    const t = tree("and", [status(), collab([A])]);
    splitCollaboratorAnyOf(t);
    expect(t.conditions).toHaveLength(2);
  });

  it("returns the SAME tree object when there is nothing to lift", () => {
    const t = tree("and", [status()]);
    const out = splitCollaboratorAnyOf(t);
    expect(out.collaboratorIds).toBeNull();
    expect(out.rest).toBe(t);
  });

  it("leaves a top-level OR tree alone (lifting one branch would change its meaning)", () => {
    const t = tree("or", [status(), collab([A])]);
    expect(splitCollaboratorAnyOf(t)).toEqual({ collaboratorIds: null, rest: t });
  });

  it("leaves a collaborators condition inside an OR sub-group alone", () => {
    const t = tree("and", [status()], [{ conjunction: "or", conditions: [collab([A])] }]);
    expect(splitCollaboratorAnyOf(t).collaboratorIds).toBeNull();
  });

  it("does not guess when two 'is any of' conditions are ANDed", () => {
    const t = tree("and", [collab([A], "is_any_of", "c1"), collab([B], "is_any_of", "c2")]);
    expect(splitCollaboratorAnyOf(t)).toEqual({ collaboratorIds: null, rest: t });
  });

  it.each(["is_not_empty", "is_empty"] as const)("does not lift '%s' (it needs no embed filter)", (op) => {
    const t = tree("and", [collab(undefined, op)]);
    expect(splitCollaboratorAnyOf(t).collaboratorIds).toBeNull();
  });

  it.each([[[]], [["not-a-uuid"]], [[A, "nope"]], ["x"], [undefined], [[1, 2]]])("does not lift an unusable value %j", (value) => {
    const t = tree("and", [collab(value)]);
    expect(splitCollaboratorAnyOf(t)).toEqual({ collaboratorIds: null, rest: t });
  });

  it("trims whitespace around ids", () => {
    expect(splitCollaboratorAnyOf(tree("and", [collab([` ${A} `])])).collaboratorIds).toEqual([A]);
  });
});
