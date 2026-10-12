import { describe, expect, it } from "vitest";
import { applicationTitle, groupDocuments } from "./group-documents";

const doc = (id: string, document_type: string, application_id: string | null = null) => ({ id, document_type, application_id });
const APPS = {
  a1: { university_name: "Arden University", program_name: "MSc Project Management" },
  a2: { university_name: "York St John University", program_name: "MBA" },
};

describe("applicationTitle", () => {
  it("joins university and programme", () => {
    expect(applicationTitle(APPS.a1)).toBe("Arden University – MSc Project Management");
  });
  it("shows just the university when there is no programme", () => {
    expect(applicationTitle({ university_name: " Arden ", program_name: "  " })).toBe("Arden");
  });
});

describe("groupDocuments", () => {
  it("puts each application's files under that application's name", () => {
    const groups = groupDocuments(
      [doc("1", "conditional_offer", "a1"), doc("2", "unconditional_offer", "a1"), doc("3", "offer_letter", "a2")],
      APPS,
    );
    expect(groups.map((g) => [g.kind, g.kind === "application" ? g.title : g.category, g.docs.map((d) => d.id)])).toEqual([
      ["application", "Arden University – MSc Project Management", ["1", "2"]],
      ["application", "York St John University – MBA", ["3"]],
    ]);
  });

  it("lists application groups first, then the normal category groups for everything else", () => {
    const groups = groupDocuments([doc("p", "passport"), doc("o", "conditional_offer", "a1"), doc("t", "transcript")], APPS);
    expect(groups.map((g) => g.key)).toEqual(["app:a1", "cat:identity", "cat:education"]);
  });

  it("orders application groups by when each first appears (newest activity first)", () => {
    const groups = groupDocuments([doc("1", "offer_letter", "a2"), doc("2", "offer_letter", "a1")], APPS);
    expect(groups.map((g) => g.key)).toEqual(["app:a2", "app:a1"]);
  });

  it("does not drop a file whose application name could not be loaded — it falls back to its category", () => {
    const groups = groupDocuments([doc("1", "conditional_offer", "missing-app")], {});
    expect(groups).toHaveLength(1);
    expect(groups[0]).toMatchObject({ kind: "category", category: "application" });
    expect(groups[0].docs).toHaveLength(1);
  });

  it("keeps ordinary documents out of application groups", () => {
    const groups = groupDocuments([doc("1", "passport", null)], APPS);
    expect(groups.every((g) => g.kind === "category")).toBe(true);
  });

  it("returns nothing for no documents", () => {
    expect(groupDocuments([], APPS)).toEqual([]);
  });

  it("puts an unknown document type in Other rather than crashing", () => {
    expect(groupDocuments([doc("1", "something_new")], APPS)[0]).toMatchObject({ kind: "category", category: "other" });
  });
});
