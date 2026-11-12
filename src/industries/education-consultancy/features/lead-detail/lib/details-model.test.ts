import { describe, it, expect } from "vitest";
import { visibleCollaborators, collaboratorControls } from "./details-model";

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
    expect(collaboratorControls(false)).toEqual({ canAdd: false, canRemove: false, lockTooltip: "Only admins can change collaborators" });
  });
});
