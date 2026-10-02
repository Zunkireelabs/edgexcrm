import { describe, it, expect } from "vitest";
import { matchesCollaboratorFilter } from "./collaborator-filter";

const map = { l1: ["u1", "u2"], l2: ["u3"], l3: [] as string[] };

describe("matchesCollaboratorFilter", () => {
  it("no selection matches every lead, including ones with no collaborators or no map entry", () => {
    for (const id of ["l1", "l2", "l3", "unknown"]) expect(matchesCollaboratorFilter(id, [], map)).toBe(true);
  });

  it("matches a lead when ANY selected person is one of its collaborators (is-any-of)", () => {
    expect(matchesCollaboratorFilter("l1", ["u2"], map)).toBe(true);
    expect(matchesCollaboratorFilter("l1", ["x", "u1"], map)).toBe(true);
  });

  it("doesn't match leads whose collaborators are all other people", () => {
    expect(matchesCollaboratorFilter("l2", ["u1"], map)).toBe(false);
  });

  it("doesn't match a lead with no collaborators or no entry when a person is selected", () => {
    expect(matchesCollaboratorFilter("l3", ["u1"], map)).toBe(false);
    expect(matchesCollaboratorFilter("unknown", ["u1"], map)).toBe(false);
  });

  it("filters a whole loaded set the way the table does: every lead the selected person collaborates on, none missed", () => {
    const leads = ["l1", "l2", "l3"];
    expect(leads.filter((id) => matchesCollaboratorFilter(id, ["u1", "u3"], map))).toEqual(["l1", "l2"]);
  });
});
