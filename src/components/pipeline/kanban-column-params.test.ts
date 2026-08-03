import { describe, it, expect } from "vitest";
import { buildKanbanColumnParams, resolveKanbanColumnParams, type KanbanFilterState } from "./kanban-column-params";

// KANBAN-PAGINATION-BRIEF §3.4: "thread every active filter into each column
// request." A column's request must carry every currently-active toolbar filter, the
// same way leads-table.tsx's buildFetchParams does for the table — miss one and
// filters silently stop working on the board (a correctness regression, per the brief).
//
// Generalized (pipeline-column-pagination Phase 2): the identity arg is now
// `{ status?, stage? }` instead of a bare status string, covering both list-Kanban
// (list, status) columns and the classic single-pipeline board's (stage_id) columns.

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
    const params = buildKanbanColumnParams(BASE, { status: "new" });
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
    expect(params.has("stage")).toBe(false);
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
    const params = buildKanbanColumnParams(state, { status: "qualified" });

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
    expect(buildKanbanColumnParams({ ...BASE, sortField: "created" }, { status: "new" }).get("sort")).toBe("created_at");
    expect(buildKanbanColumnParams({ ...BASE, sortField: "updated" }, { status: "new" }).get("sort")).toBe("updated_at");
    expect(buildKanbanColumnParams({ ...BASE, sortField: "name" }, { status: "new" }).get("sort")).toBe("first_name");
    expect(buildKanbanColumnParams({ ...BASE, sortField: "email" }, { status: "new" }).get("sort")).toBe("email");
  });

  it("stage-mode column identity: sets ?stage= instead of ?status=, and omits ?list= when listSlug is unset", () => {
    const stageState: KanbanFilterState = { ...BASE, listSlug: undefined };
    const params = buildKanbanColumnParams(stageState, { stage: "stage-uuid-1" });
    expect(params.get("stage")).toBe("stage-uuid-1");
    expect(params.has("status")).toBe(false);
    expect(params.has("list")).toBe(false);
  });
});

describe("resolveKanbanColumnParams — global Status filter vs. a column's own identity", () => {
  it("returns full params when no global status filter is active", () => {
    const params = resolveKanbanColumnParams(BASE, "all", "new", { status: "new" });
    expect(params).not.toBeNull();
    expect(params!.get("status")).toBe("new");
  });

  it("returns full params when the global status filter matches this column", () => {
    const params = resolveKanbanColumnParams(BASE, "qualified", "qualified", { status: "qualified" });
    expect(params).not.toBeNull();
    expect(params!.get("status")).toBe("qualified");
  });

  it("returns null (skip fetching) when the global status filter names a DIFFERENT column", () => {
    const params = resolveKanbanColumnParams(BASE, "qualified", "new", { status: "new" });
    expect(params).toBeNull();
  });

  it("stage-mode: returns full params (with ?stage=) when the column's slug matches the global filter", () => {
    const stageState: KanbanFilterState = { ...BASE, listSlug: undefined };
    const params = resolveKanbanColumnParams(stageState, "qualified", "qualified", { stage: "stage-uuid-2" });
    expect(params).not.toBeNull();
    expect(params!.get("stage")).toBe("stage-uuid-2");
    expect(params!.has("status")).toBe(false);
  });

  it("stage-mode: returns null when the column's slug does NOT match the global filter", () => {
    const stageState: KanbanFilterState = { ...BASE, listSlug: undefined };
    const params = resolveKanbanColumnParams(stageState, "qualified", "new", { stage: "stage-uuid-2" });
    expect(params).toBeNull();
  });
});
