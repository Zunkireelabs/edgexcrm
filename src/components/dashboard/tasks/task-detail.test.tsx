// @vitest-environment jsdom
//
// Regression guard for the PR #500 defect class (per the Round 2 slice A
// review): a non-admin, non-owning viewer of a project task must see
// read-only badges/text, never the editable controls (Input/Select/Delete)
// that PATCH/DELETE /api/v1/tasks/[id] would reject from them anyway.

import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { TaskDetailBody, type TaskDetailTask } from "./task-detail";

const BASE_TASK: TaskDetailTask = {
  id: "task-1",
  tenant_id: "tenant-1",
  project_id: "project-1",
  title: "Ship the thing",
  description: "Some description",
  status: "todo",
  estimated_minutes: 60,
  is_billable: true,
  assignee_id: "user-assignee",
  assigned_by_id: "user-assigner",
  lead_id: null,
  deal_id: null,
  due_date: null,
  priority: "normal",
  tags: [],
  created_at: new Date().toISOString(),
  updated_at: new Date().toISOString(),
  projects: { id: "project-1", name: "Project X" },
  leads: null,
  deals: null,
};

function mockFetch(task: TaskDetailTask) {
  return vi.fn((input: RequestInfo | URL) => {
    const url = String(input);
    if (url.includes("/api/v1/tasks/") && !url.includes("/tags")) {
      return Promise.resolve({
        ok: true,
        status: 200,
        json: async () => ({ data: task }),
      } as Response);
    }
    if (url.includes("/api/v1/tasks/tags")) {
      return Promise.resolve({ ok: true, status: 200, json: async () => ({ data: [] }) } as Response);
    }
    if (url.includes("/api/v1/team")) {
      return Promise.resolve({
        ok: true,
        status: 200,
        json: async () => ({
          data: [
            { user_id: "user-assignee", name: "Assignee Person" },
            { user_id: "user-assigner", name: "Assigner Person" },
          ],
        }),
      } as Response);
    }
    return Promise.resolve({ ok: false, status: 404, json: async () => ({}) } as Response);
  });
}

describe("TaskDetailBody", () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    global.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("renders a non-admin, non-owner viewer read-only — no title Input, no status Select, no Delete button", async () => {
    global.fetch = mockFetch(BASE_TASK) as unknown as typeof fetch;

    render(
      <TaskDetailBody
        taskId="task-1"
        currentUserId="user-viewer"
        isAdmin={false}
        canManageProjects={false}
      />
    );

    await waitFor(() => expect(screen.getByText("Ship the thing")).toBeInTheDocument());

    // The editable title Input renders as a plain <input> with no accessible
    // name — assert by absence of any input holding the title value.
    expect(screen.queryAllByDisplayValue("Ship the thing")).toHaveLength(0);
    expect(screen.queryByRole("combobox")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /delete task/i })).not.toBeInTheDocument();
  });

  it("renders an admin with editable controls — title Input, status Select, Delete button", async () => {
    global.fetch = mockFetch(BASE_TASK) as unknown as typeof fetch;

    render(
      <TaskDetailBody
        taskId="task-1"
        currentUserId="user-viewer"
        isAdmin={true}
        canManageProjects={true}
      />
    );

    await waitFor(() => expect(screen.getByDisplayValue("Ship the thing")).toBeInTheDocument());

    expect(screen.getByRole("combobox")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /delete task/i })).toBeInTheDocument();
  });
});
