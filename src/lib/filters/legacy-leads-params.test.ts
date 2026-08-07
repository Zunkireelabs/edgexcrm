import { describe, it, expect } from "vitest";
import { legacyLeadsParamsToTree } from "./legacy-leads-params";

function sp(entries: Record<string, string>): URLSearchParams {
  return new URLSearchParams(entries);
}

describe("legacyLeadsParamsToTree", () => {
  it("returns an empty and-tree when no params are present", () => {
    const tree = legacyLeadsParamsToTree(sp({}));
    expect(tree).toEqual({ conjunction: "and", conditions: [] });
  });

  it("maps status -> field:status op:is", () => {
    const tree = legacyLeadsParamsToTree(sp({ status: "new" }));
    expect(tree.conditions).toContainEqual({ id: "legacy:status", field: "status", op: "is", value: "new" });
  });

  it("ignores status=all", () => {
    const tree = legacyLeadsParamsToTree(sp({ status: "all" }));
    expect(tree.conditions.find((c) => c.field === "status")).toBeUndefined();
  });

  it("maps search -> field:search op:contains, trimmed", () => {
    const tree = legacyLeadsParamsToTree(sp({ search: "  jane doe  " }));
    expect(tree.conditions).toContainEqual({ id: "legacy:search", field: "search", op: "contains", value: "jane doe" });
  });

  it("ignores a blank/whitespace-only search", () => {
    const tree = legacyLeadsParamsToTree(sp({ search: "   " }));
    expect(tree.conditions.find((c) => c.field === "search")).toBeUndefined();
  });

  it("maps form -> field:form op:is, ignoring 'all'", () => {
    expect(legacyLeadsParamsToTree(sp({ form: "abc-123" })).conditions).toContainEqual({
      id: "legacy:form",
      field: "form",
      op: "is",
      value: "abc-123",
    });
    expect(legacyLeadsParamsToTree(sp({ form: "all" })).conditions).toEqual([]);
  });

  it("maps tag -> field:tags op:has_all with a single-item array, ignoring 'all'", () => {
    expect(legacyLeadsParamsToTree(sp({ tag: "vip" })).conditions).toContainEqual({
      id: "legacy:tag",
      field: "tags",
      op: "has_all",
      value: ["vip"],
    });
    expect(legacyLeadsParamsToTree(sp({ tag: "all" })).conditions).toEqual([]);
  });

  it.each([
    ["today", "1d"],
    ["week", "7d"],
    ["month", "30d"],
  ])("maps created=%s -> field:created op:within_last value:%s", (window, relative) => {
    expect(legacyLeadsParamsToTree(sp({ created: window })).conditions).toContainEqual({
      id: "legacy:created",
      field: "created",
      op: "within_last",
      value: relative,
    });
  });

  it("ignores created=all and an unrecognized window", () => {
    expect(legacyLeadsParamsToTree(sp({ created: "all" })).conditions).toEqual([]);
    expect(legacyLeadsParamsToTree(sp({ created: "decade" })).conditions).toEqual([]);
  });

  it("maps industry -> field:industry op:is, ignoring 'all'", () => {
    expect(legacyLeadsParamsToTree(sp({ industry: "engineering" })).conditions).toContainEqual({
      id: "legacy:industry",
      field: "industry",
      op: "is",
      value: "engineering",
    });
  });

  it("maps industry=__none__ -> field:industry op:is_empty, no value", () => {
    const tree = legacyLeadsParamsToTree(sp({ industry: "__none__" }));
    expect(tree.conditions).toContainEqual({ id: "legacy:industry", field: "industry", op: "is_empty" });
  });

  it("maps source (csv) -> field:source op:is_any_of", () => {
    expect(legacyLeadsParamsToTree(sp({ source: "web, referral ,ads" })).conditions).toContainEqual({
      id: "legacy:source",
      field: "source",
      op: "is_any_of",
      value: ["web", "referral", "ads"],
    });
  });

  it("omits source condition entirely when the csv is empty", () => {
    expect(legacyLeadsParamsToTree(sp({ source: "" })).conditions.find((c) => c.field === "source")).toBeUndefined();
  });

  it("maps assignees (csv, incl. 'unassigned' token) -> field:assignees op:is_any_of", () => {
    expect(legacyLeadsParamsToTree(sp({ assignees: "unassigned,11111111-1111-1111-1111-111111111111" })).conditions).toContainEqual({
      id: "legacy:assignees",
      field: "assignees",
      op: "is_any_of",
      value: ["unassigned", "11111111-1111-1111-1111-111111111111"],
    });
  });

  it("maps collaborators (csv) -> field:collaborators op:is_any_of", () => {
    expect(legacyLeadsParamsToTree(sp({ collaborators: "22222222-2222-2222-2222-222222222222" })).conditions).toContainEqual({
      id: "legacy:collaborators",
      field: "collaborators",
      op: "is_any_of",
      value: ["22222222-2222-2222-2222-222222222222"],
    });
  });

  it("combines every param into one AND'd root tree", () => {
    const tree = legacyLeadsParamsToTree(
      sp({ status: "new", search: "jane", form: "f1", tag: "vip", created: "week", industry: "eng", source: "web", assignees: "a1", collaborators: "c1" })
    );
    expect(tree.conjunction).toBe("and");
    expect(tree.groups).toBeUndefined();
    expect(tree.conditions).toHaveLength(9);
  });

  describe("scope params are never included", () => {
    const scopeParams = {
      list: "prospects",
      funnel: "sales",
      stage: "stage-id",
      branch_id: "branch-1",
      assigned_to: "user-1", // singular scope — NOT the plural `assignees` toolbar filter
      include_converted: "1",
      page: "2",
      pageSize: "50",
      count: "0",
      sort: "created_at",
      order: "desc",
      facets: "source",
    };

    it("produces zero conditions from a params object containing ONLY scope params", () => {
      const tree = legacyLeadsParamsToTree(sp(scopeParams));
      expect(tree.conditions).toEqual([]);
    });

    it("scope params don't leak in even when toolbar filters are also present", () => {
      const tree = legacyLeadsParamsToTree(sp({ ...scopeParams, status: "new" }));
      expect(tree.conditions).toHaveLength(1);
      expect(tree.conditions[0].field).toBe("status");
      for (const key of Object.keys(scopeParams)) {
        expect(tree.conditions.some((c) => c.field === key)).toBe(false);
      }
    });

    it("assigned_to (scope, singular) never produces an 'assignees' condition", () => {
      const tree = legacyLeadsParamsToTree(sp({ assigned_to: "user-1" }));
      expect(tree.conditions.find((c) => c.field === "assignees")).toBeUndefined();
    });
  });
});
