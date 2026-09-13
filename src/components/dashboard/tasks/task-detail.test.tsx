// @vitest-environment jsdom
//
// Regression guard for the PR #500 defect class (per the Round 2 slice A
// review): a non-admin, non-owning viewer of a project task must see
// read-only badges/text, never the editable controls (Input/Select/Delete)
// that PATCH/DELETE /api/v1/tasks/[id] would reject from them anyway.

import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, waitFor, fireEvent, cleanup } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { TaskDetailBody, type TaskDetailTask } from "./task-detail";

const toastError = vi.fn();
const toastSuccess = vi.fn();
vi.mock("sonner", () => ({
  toast: { success: (...a: unknown[]) => toastSuccess(...a), error: (...a: unknown[]) => toastError(...a) },
}));

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

function mockFetch(task: TaskDetailTask, opts?: { patchOk?: boolean }) {
  const patchOk = opts?.patchOk ?? true;
  return vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    // The /comments branch MUST come before the generic /api/v1/tasks/ branch
    // below — that one only excludes /tags, so /api/v1/tasks/<id>/comments
    // would otherwise be served the task object (brief §5 warning).
    if (url.includes("/comments")) {
      return Promise.resolve({ ok: true, status: 200, json: async () => ({ data: [] }) } as Response);
    }
    if (url.includes("/api/v1/tasks/") && !url.includes("/tags")) {
      if (init?.method === "PATCH") {
        if (!patchOk) {
          return Promise.resolve({
            ok: false,
            status: 500,
            json: async () => ({ error: { message: "Failed to update task" } }),
          } as Response);
        }
        const patch = JSON.parse(String(init.body));
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({ data: { ...task, ...patch } }),
        } as Response);
      }
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
    cleanup();
    global.fetch = originalFetch;
    vi.restoreAllMocks();
    toastError.mockClear();
    toastSuccess.mockClear();
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

  it("renders an admin with editable controls — title Input, status Select, and a reachable Delete task action", async () => {
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

    // Delete moved off the panel's main surface into the "···" overflow menu
    // (Round 2 slice C §2.3) — a real destructive-action AlertDialog replaces
    // the old onBlur-cancelled two-click hack.
    const moreButton = screen.getByRole("button", { name: /more actions/i });
    fireEvent.pointerDown(moreButton);
    fireEvent.click(moreButton);
    await waitFor(() => expect(screen.getByText("Delete task")).toBeInTheDocument());
  });

  it("canEdit viewer sees Mark complete; a read-only viewer sees a status badge and no button", async () => {
    global.fetch = mockFetch(BASE_TASK) as unknown as typeof fetch;
    const first = render(<TaskDetailBody taskId="task-1" currentUserId="user-viewer" isAdmin canManageProjects />);
    await waitFor(() => expect(screen.getByDisplayValue("Ship the thing")).toBeInTheDocument());
    expect(screen.getByRole("button", { name: /mark complete/i })).toBeInTheDocument();
    first.unmount();

    global.fetch = mockFetch(BASE_TASK) as unknown as typeof fetch;
    render(
      <TaskDetailBody taskId="task-1" currentUserId="user-viewer" isAdmin={false} canManageProjects={false} />
    );
    await waitFor(() => expect(screen.getByText("Ship the thing")).toBeInTheDocument());
    expect(screen.queryByRole("button", { name: /mark complete/i })).not.toBeInTheDocument();
    expect(screen.getByText(/not completed/i)).toBeInTheDocument();
  });

  it("a done task shows Completed, and clicking it PATCHes status back to todo", async () => {
    const done: TaskDetailTask = { ...BASE_TASK, status: "done" };
    global.fetch = mockFetch(done) as unknown as typeof fetch;
    render(<TaskDetailBody taskId="task-1" currentUserId="user-viewer" isAdmin canManageProjects />);
    await waitFor(() => expect(screen.getByDisplayValue("Ship the thing")).toBeInTheDocument());

    const completedButton = screen.getByRole("button", { name: /completed/i });
    expect(completedButton).toBeInTheDocument();
    fireEvent.click(completedButton);

    await waitFor(() => {
      const calls = (global.fetch as unknown as ReturnType<typeof vi.fn>).mock.calls;
      const patchCall = calls.find((c) => c[1]?.method === "PATCH");
      expect(patchCall).toBeTruthy();
      expect(JSON.parse(String(patchCall![1].body))).toMatchObject({ status: "todo" });
    });
  });

  it("tags render the default placeholder — the '+ tag' regression is absent", async () => {
    global.fetch = mockFetch(BASE_TASK) as unknown as typeof fetch;
    render(<TaskDetailBody taskId="task-1" currentUserId="user-viewer" isAdmin canManageProjects />);
    await waitFor(() => expect(screen.getByDisplayValue("Ship the thing")).toBeInTheDocument());
    expect(screen.queryByText("+ tag")).not.toBeInTheDocument();
    expect(screen.getByText("Add tags…")).toBeInTheDocument();
  });

  it("an overdue due date renders the overdue treatment; a done task with a past due date does not", async () => {
    const overdue: TaskDetailTask = { ...BASE_TASK, due_date: "2000-01-01", status: "todo" };
    global.fetch = mockFetch(overdue) as unknown as typeof fetch;
    const first = render(<TaskDetailBody taskId="task-1" currentUserId="user-viewer" isAdmin canManageProjects />);
    await waitFor(() => expect(screen.getByDisplayValue("Ship the thing")).toBeInTheDocument());
    expect(screen.getByText("⚠")).toBeInTheDocument();
    first.unmount();

    const doneWithPastDue: TaskDetailTask = { ...BASE_TASK, due_date: "2000-01-01", status: "done" };
    global.fetch = mockFetch(doneWithPastDue) as unknown as typeof fetch;
    render(<TaskDetailBody taskId="task-1" currentUserId="user-viewer" isAdmin canManageProjects />);
    await waitFor(() => expect(screen.getByDisplayValue("Ship the thing")).toBeInTheDocument());
    expect(screen.queryByText("⚠")).not.toBeInTheDocument();
  });

  it("optimistic revert: a failing PATCH flips to Completed immediately, then reverts and toasts", async () => {
    global.fetch = mockFetch(BASE_TASK, { patchOk: false }) as unknown as typeof fetch;
    render(<TaskDetailBody taskId="task-1" currentUserId="user-viewer" isAdmin canManageProjects />);
    await waitFor(() => expect(screen.getByDisplayValue("Ship the thing")).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: /mark complete/i }));

    // Optimistic: flips to "Completed" immediately, before the failing PATCH resolves.
    await waitFor(() => expect(screen.getByRole("button", { name: /^completed$/i })).toBeInTheDocument());

    // Reverted: once the failed response lands, it flips back to "Mark complete" and toasts.
    await waitFor(() => expect(screen.getByRole("button", { name: /mark complete/i })).toBeInTheDocument());
    expect(screen.queryByRole("button", { name: /^completed$/i })).not.toBeInTheDocument();
    expect(toastError).toHaveBeenCalledWith("Failed to update task");
  });
});
