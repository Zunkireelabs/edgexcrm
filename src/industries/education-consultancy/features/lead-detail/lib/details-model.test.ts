import { describe, it, expect } from "vitest";
import { visibleCollaborators, collaboratorControls, canRemoveCollaborator } from "./details-model";

const c = (id: string) => ({ user_id: id, email: `${id}@x`, name: id });

describe("collaborators row", () => {
  it("hides the counsellor from the collaborator list", () => {
    expect(visibleCollaborators([c("a"), c("b")], "a").map((x) => x.user_id)).toEqual(["b"]);
  });
  it("keeps everyone when there is no counsellor", () => {
    expect(visibleCollaborators([c("a")], null)).toHaveLength(1);
  });
  it("gives only admins add / remove controls, with the lock tooltip for the rest", () => {
    expect(collaboratorControls(true)).toEqual({ canAdd: true, canRemove: true, lockTooltip: null });
    expect(collaboratorControls(false)).toEqual({ canAdd: false, canRemove: false, lockTooltip: "Only admins and branch managers can change collaborators" });
    expect(collaboratorControls(false, true)).toEqual({ canAdd: true, canRemove: true, lockTooltip: null });
  });
  it("a collaborator can always remove themselves, nobody else unless allowed", () => {
    expect(canRemoveCollaborator("a", "a", false)).toBe(true);
    expect(canRemoveCollaborator("b", "a", false)).toBe(false);
    expect(canRemoveCollaborator("b", "a", true)).toBe(true);
  });
});
