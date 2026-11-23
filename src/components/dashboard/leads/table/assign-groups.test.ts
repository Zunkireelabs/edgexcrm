import { describe, expect, it } from "vitest";
import { assignGroup, pluralGroup, roleLabel } from "./assign-groups";

describe("assign groups", () => {
  it("merges base-role counselor and a Counsellor position holder under one 'Counsellors' heading", () => {
    const members = [
      { position: undefined, role: "counselor" },
      { position: "Counsellor", role: "viewer" },
    ];
    const groups = new Set(members.map((m) => assignGroup(m.position, m.role)));
    expect([...groups]).toEqual(["Counsellors"]);
  });

  it("pluralises headings and leaves Other alone", () => {
    expect(pluralGroup("App Executive")).toBe("App Executives");
    expect(pluralGroup("Admin")).toBe("Admins");
    expect(pluralGroup("Branch")).toBe("Branches");
    expect(pluralGroup("Other")).toBe("Other");
    expect(roleLabel("owner")).toBe("Owner");
  });
});
