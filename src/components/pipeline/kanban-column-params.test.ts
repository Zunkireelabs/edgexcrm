import { describe, it, expect } from "vitest";
import { buildKanbanColumnParams, resolveKanbanColumnParams, type KanbanFilterState } from "./kanban-column-params";

// KANBAN-PAGINATION-BRIEF §3.4: "thread every active filter into each column
// request." A column's request must carry every currently-active toolbar filter, the
// same way leads-table.tsx's buildFetchParams does for the table — miss one and
// filters silently stop working on the board (a correctness regression, per the brief).

const BASE: KanbanFilterState = {
  listSlug: "prospects",
  sortField: "updated",
  sortDirection: "desc",
  debouncedSearch: "",
  counselorFilter: [],
  collaboratorFilter: [],
  sourceFilter: [],
  tagFilter: "all",
  formFilter: "all",
  createdFilter: "all",
  industryFilter: "all",
};

describe("buildKanbanColumnParams", () => {
  it("always carries list + status + sort + order, even with no filters active", () => {
    const params = buildKanbanColumnParams(BASE, "new");
    expect(params.get("list")).toBe("prospects");
    expect(params.get("status")).toBe("new");
    expect(params.get("sort")).toBe("updated_at");
    expect(params.get("order")).toBe("desc");
    // No optional filter params leak through when inactive
    expect(params.has("search")).toBe(false);
    expect(params.has("assignees")).toBe(false);
    expect(params.has("collaborators")).toBe(false);
    expect(params.has("source")).toBe(false);
    expect(params.has("tag")).toBe(false);
    expect(params.has("form")).toBe(false);
    expect(params.has("created")).toBe(false);
    expect(params.has("industry")).toBe(false);
  });

  it("threads every active filter into the request", () => {
    const state: KanbanFilterState = {
      ...BASE,
      sortField: "created",
      sortDirection: "asc",
      debouncedSearch: "priya",
      counselorFilter: ["user-1", "unassigned"],
      collaboratorFilter: ["user-2"],
      sourceFilter: ["Facebook", "Google"],
      tagFilter: "student",
      formFilter: "form-a",
      createdFilter: "week",
      industryFilter: "fintech",
    };
    const params = buildKanbanColumnParams(state, "qualified");

    expect(params.get("sort")).toBe("created_at");
    expect(params.get("order")).toBe("asc");
    expect(params.get("search")).toBe("priya");
    expect(params.get("assignees")).toBe("user-1,unassigned");
    expect(params.get("collaborators")).toBe("user-2");
    expect(params.get("source")).toBe("Facebook,Google");
    expect(params.get("tag")).toBe("student");
    expect(params.get("form")).toBe("form-a");
    expect(params.get("created")).toBe("week");
    expect(params.get("industry")).toBe("fintech");
  });

  it("maps every sortField to the route's SORT_COLUMNS keys", () => {
    expect(buildKanbanColumnParams({ ...BASE, sortField: "created" }, "new").get("sort")).toBe("created_at");
    expect(buildKanbanColumnParams({ ...BASE, sortField: "updated" }, "new").get("sort")).toBe("updated_at");
    expect(buildKanbanColumnParams({ ...BASE, sortField: "name" }, "new").get("sort")).toBe("first_name");
    expect(buildKanbanColumnParams({ ...BASE, sortField: "email" }, "new").get("sort")).toBe("email");
  });
});

describe("resolveKanbanColumnParams — global Status filter vs. a column's own identity", () => {
  it("returns full params when no global status filter is active", () => {
    const params = resolveKanbanColumnParams(BASE, "all", "new");
    expect(params).not.toBeNull();
    expect(params!.get("status")).toBe("new");
  });

  it("returns full params when the global status filter matches this column", () => {
    const params = resolveKanbanColumnParams(BASE, "qualified", "qualified");
    expect(params).not.toBeNull();
    expect(params!.get("status")).toBe("qualified");
  });

  it("returns null (skip fetching) when the global status filter names a DIFFERENT column", () => {
    const params = resolveKanbanColumnParams(BASE, "qualified", "new");
    expect(params).toBeNull();
  });
});
