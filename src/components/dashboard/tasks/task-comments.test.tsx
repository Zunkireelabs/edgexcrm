// @vitest-environment jsdom
//
// Round 2 slice C Phase 2 (docs/IT-AGENCY-ROUND2-TASK-PANEL-BRIEF.md §5).

import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, waitFor, fireEvent, cleanup } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { TaskComments } from "./task-comments";

const TEAM = [
  { user_id: "u-author", name: "Author Person" },
  { user_id: "u-viewer", name: "Viewer Person" },
];

function mockFetch(comments: unknown[], opts?: { postOk?: boolean }) {
  const postOk = opts?.postOk ?? true;
  return vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const method = init?.method;
    if (!method || method === "GET") {
      return Promise.resolve({ ok: true, status: 200, json: async () => ({ data: comments }) } as Response);
    }
    if (method === "POST") {
      if (!postOk) {
        return Promise.resolve({
          ok: false,
          status: 500,
          json: async () => ({ error: { message: "Failed to post comment" } }),
        } as Response);
      }
      const body = JSON.parse(String(init.body));
      return Promise.resolve({
        ok: true,
        status: 201,
        json: async () => ({
          data: { id: "c-new", task_id: "task-1", author_id: "u-author", body: body.body, created_at: new Date().toISOString() },
        }),
      } as Response);
    }
    return Promise.resolve({ ok: true, status: 200, json: async () => ({ data: { id: "c-1" } }) } as Response);
  });
}

describe("TaskComments", () => {
  const originalFetch = global.fetch;
  afterEach(() => {
    cleanup();
    global.fetch = originalFetch;
    vi.restoreAllMocks();
  });

  it("renders the empty state when there are no comments", async () => {
    global.fetch = mockFetch([]) as unknown as typeof fetch;
    render(<TaskComments taskId="task-1" currentUserId="u-author" isAdmin={false} team={TEAM} />);
    await waitFor(() => expect(screen.getByText(/no comments yet/i)).toBeInTheDocument());
  });

  it("posts a comment optimistically", async () => {
    global.fetch = mockFetch([]) as unknown as typeof fetch;
    render(<TaskComments taskId="task-1" currentUserId="u-author" isAdmin={false} team={TEAM} />);
    await waitFor(() => expect(screen.getByText(/no comments yet/i)).toBeInTheDocument());

    fireEvent.change(screen.getByPlaceholderText(/write a comment/i), { target: { value: "client pushed the date" } });
    fireEvent.click(screen.getByRole("button", { name: /comment/i }));

    await waitFor(() => expect(screen.getByText("client pushed the date")).toBeInTheDocument());
  });

  it("removes the optimistic row when the post fails", async () => {
    global.fetch = mockFetch([], { postOk: false }) as unknown as typeof fetch;
    render(<TaskComments taskId="task-1" currentUserId="u-author" isAdmin={false} team={TEAM} />);
    await waitFor(() => expect(screen.getByText(/no comments yet/i)).toBeInTheDocument());

    fireEvent.change(screen.getByPlaceholderText(/write a comment/i), { target: { value: "will fail" } });
    fireEvent.click(screen.getByRole("button", { name: /comment/i }));

    await waitFor(() => expect(screen.getByText(/no comments yet/i)).toBeInTheDocument());
    // "will fail" is restored into the composer's Textarea on failure (so the
    // author doesn't lose what they typed) — assert there's no rendered
    // comment bubble for it, not that the string is absent from the DOM.
    expect(document.querySelector("p.whitespace-pre-wrap")).not.toBeInTheDocument();
  });

  it("shows the delete affordance for the author and for an admin, not for a third party", async () => {
    const existing = [
      { id: "c-1", task_id: "task-1", author_id: "u-author", body: "hello", created_at: new Date().toISOString() },
    ];

    global.fetch = mockFetch(existing) as unknown as typeof fetch;
    const { unmount } = render(<TaskComments taskId="task-1" currentUserId="u-author" isAdmin={false} team={TEAM} />);
    await waitFor(() => expect(screen.getByText("hello")).toBeInTheDocument());
    expect(screen.getByRole("button", { name: /delete comment/i })).toBeInTheDocument();
    unmount();

    global.fetch = mockFetch(existing) as unknown as typeof fetch;
    const { unmount: unmount2 } = render(
      <TaskComments taskId="task-1" currentUserId="u-viewer" isAdmin={true} team={TEAM} />
    );
    await waitFor(() => expect(screen.getByText("hello")).toBeInTheDocument());
    expect(screen.getByRole("button", { name: /delete comment/i })).toBeInTheDocument();
    unmount2();

    global.fetch = mockFetch(existing) as unknown as typeof fetch;
    render(<TaskComments taskId="task-1" currentUserId="u-viewer" isAdmin={false} team={TEAM} />);
    await waitFor(() => expect(screen.getByText("hello")).toBeInTheDocument());
    expect(screen.queryByRole("button", { name: /delete comment/i })).not.toBeInTheDocument();
  });
});
