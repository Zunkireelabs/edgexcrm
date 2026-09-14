// @vitest-environment jsdom
//
// Round 2 slice B (§3a, §4 item 4) — the ⌘K quick-add action row. A query
// that matches no nav item surfaces "Create task "<query>"" in an Actions
// group; selecting it POSTs to the task-create endpoint.

import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { GlobalSearchPalette } from "./global-search-palette";
import type { NavResult } from "./build-nav-index";

// cmdk (via Radix's Dialog + its own internals) measures elements in an
// effect; jsdom has no ResizeObserver.
class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
(global as unknown as { ResizeObserver: typeof ResizeObserverStub }).ResizeObserver = ResizeObserverStub;
if (!Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = () => {};
}

const routerPush = vi.fn();
const pathnameRef = { current: "/home" };
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: routerPush }),
  usePathname: () => pathnameRef.current,
}));

vi.mock("@/contexts/settings-modal-context", () => ({
  useSettingsModal: () => ({ openSettings: vi.fn() }),
}));

const toastSuccess = vi.fn();
const toastError = vi.fn();
vi.mock("sonner", () => ({
  toast: { success: (...a: unknown[]) => toastSuccess(...a), error: (...a: unknown[]) => toastError(...a) },
}));

const NAV_INDEX: NavResult[] = [
  { id: "leads", label: "Leads", keywords: ["leads"], group: "Pages", icon: "Users", action: { kind: "route", href: "/leads" } },
];

function renderPalette(props: Partial<React.ComponentProps<typeof GlobalSearchPalette>> = {}) {
  return render(
    <GlobalSearchPalette
      isOpen
      onClose={vi.fn()}
      navIndex={NAV_INDEX}
      currentUserId="user-1"
      {...props}
    />
  );
}

describe("GlobalSearchPalette — quick-add", () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    cleanup();
    global.fetch = originalFetch;
    vi.clearAllMocks();
    pathnameRef.current = "/home";
  });

  it("a query matching no nav item surfaces the Create task action", () => {
    renderPalette();
    const input = screen.getByPlaceholderText("Search pages, leads… or type a task, @ to assign");
    fireEvent.change(input, { target: { value: "Fix the login bug" } });

    expect(screen.getByText('Create task “Fix the login bug”')).toBeInTheDocument();
  });

  it("a query matching a nav item does not surface the action row", () => {
    renderPalette();
    const input = screen.getByPlaceholderText("Search pages, leads… or type a task, @ to assign");
    fireEvent.change(input, { target: { value: "Leads" } });

    expect(screen.queryByText(/^Create task/)).not.toBeInTheDocument();
  });

  it("selecting it posts to /api/v1/my-tasks when not on a project page, then toasts and closes", async () => {
    const onClose = vi.fn();
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({ data: { id: "task-9", title: "Fix the login bug" } }),
    }));
    global.fetch = fetchMock as unknown as typeof fetch;

    renderPalette({ onClose });
    const input = screen.getByPlaceholderText("Search pages, leads… or type a task, @ to assign");
    fireEvent.change(input, { target: { value: "Fix the login bug" } });
    fireEvent.click(screen.getByText('Create task “Fix the login bug”'));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("/api/v1/my-tasks");
    expect(JSON.parse(init.body as string)).toEqual({ title: "Fix the login bug" });
    await waitFor(() => expect(onClose).toHaveBeenCalled());
    expect(toastSuccess).toHaveBeenCalled();
  });

  it("on a project page, posts to the project tasks endpoint self-assigned", async () => {
    pathnameRef.current = "/projects/11111111-1111-1111-1111-111111111111";
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({ data: { id: "task-9", title: "Ship it" } }),
    }));
    global.fetch = fetchMock as unknown as typeof fetch;

    renderPalette();
    const input = screen.getByPlaceholderText("Search pages, leads… or type a task, @ to assign");
    fireEvent.change(input, { target: { value: "Ship it" } });
    fireEvent.click(screen.getByText('Create task “Ship it”'));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("/api/v1/projects/11111111-1111-1111-1111-111111111111/tasks");
    expect(JSON.parse(init.body as string)).toEqual({ title: "Ship it", assignee_id: "user-1" });
  });
});

const ROSTER = [
  { user_id: "u-hardik", name: "Hardik Shrestha" },
  { user_id: "u-harish", name: "Harish Gupta" },
];

// Routes fetch by URL/path so a single mock can serve both the roster fetch
// and the task-create/bulk POST within one test.
function routedFetchMock(handlers: Record<string, () => unknown>) {
  return vi.fn(async (url: string) => {
    for (const [path, respond] of Object.entries(handlers)) {
      if (url.includes(path)) {
        return { ok: true, json: async () => respond() };
      }
    }
    return { ok: true, json: async () => ({ data: [] }) };
  });
}

describe("GlobalSearchPalette — @mention quick-add (Round 2 slice E §3.2)", () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    cleanup();
    global.fetch = originalFetch;
    vi.clearAllMocks();
    pathnameRef.current = "/home";
  });

  it("a token with one match posts assignee_id to /api/v1/my-tasks", async () => {
    const fetchMock = routedFetchMock({
      "/api/v1/team": () => ({ data: [{ user_id: "u-hardik", name: "Hardik Shrestha" }] }),
      "/api/v1/my-tasks": () => ({ data: { id: "task-1", title: "Send invoice" } }),
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    renderPalette();
    const input = screen.getByPlaceholderText("Search pages, leads… or type a task, @ to assign");
    fireEvent.change(input, { target: { value: "Send invoice @hard" } });

    await waitFor(() => expect(screen.getByText(/Create task .* for Hardik Shrestha/)).toBeInTheDocument());
    fireEvent.click(screen.getByText(/Create task .* for Hardik Shrestha/));

    const postCall = await waitFor(() =>
      fetchMock.mock.calls.find((c) => (c[0] as string).includes("/api/v1/my-tasks")),
    );
    expect(postCall).toBeDefined();
    const init = (postCall as unknown as [string, RequestInit])[1];
    expect(JSON.parse(init.body as string)).toEqual({ title: "Send invoice", assignee_id: "u-hardik" });
  });

  it("a token matching two people renders two rows", async () => {
    const fetchMock = routedFetchMock({ "/api/v1/team": () => ({ data: ROSTER }) });
    global.fetch = fetchMock as unknown as typeof fetch;

    renderPalette();
    const input = screen.getByPlaceholderText("Search pages, leads… or type a task, @ to assign");
    fireEvent.change(input, { target: { value: "Fix bug @har" } });

    await waitFor(() => {
      expect(screen.getByText(/for Hardik Shrestha/)).toBeInTheDocument();
      expect(screen.getByText(/for Harish Gupta/)).toBeInTheDocument();
    });
  });

  it("a token matching nobody renders a disabled row and posts nothing", async () => {
    const fetchMock = routedFetchMock({ "/api/v1/team": () => ({ data: ROSTER }) });
    global.fetch = fetchMock as unknown as typeof fetch;

    renderPalette();
    const input = screen.getByPlaceholderText("Search pages, leads… or type a task, @ to assign");
    fireEvent.change(input, { target: { value: "Call vendor @zzz" } });

    await waitFor(() => expect(screen.getByText('No teammate matches “@zzz”')).toBeInTheDocument());
    fireEvent.click(screen.getByText('No teammate matches “@zzz”'));

    await new Promise((r) => setTimeout(r, 10));
    expect(fetchMock.mock.calls.some((c) => (c[0] as string).includes("/api/v1/my-tasks"))).toBe(false);
  });
});

describe("GlobalSearchPalette — multi-line paste batch (Round 2 slice E §3.3)", () => {
  const originalFetch = global.fetch;

  afterEach(() => {
    cleanup();
    global.fetch = originalFetch;
    vi.clearAllMocks();
    pathnameRef.current = "/home";
  });

  function pasteInto(input: HTMLElement, text: string) {
    fireEvent.paste(input, {
      clipboardData: { getData: () => text },
    });
  }

  it("a multi-line paste renders the batch preview and posts to /bulk once", async () => {
    const fetchMock = routedFetchMock({
      "/api/v1/my-tasks/bulk": () => ({ data: { created: ["t1", "t2", "t3"], failed: 0 } }),
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    renderPalette();
    const input = screen.getByPlaceholderText("Search pages, leads… or type a task, @ to assign");
    pasteInto(input, "Call vendor\nSend invoice\nBook flights");

    await waitFor(() => expect(screen.getByText("Create 3 tasks")).toBeInTheDocument());
    fireEvent.click(screen.getByText("Create 3 tasks"));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("/api/v1/my-tasks/bulk");
    expect(JSON.parse(init.body as string)).toEqual({
      titles: ["Call vendor", "Send invoice", "Book flights"],
      assignee_id: null,
      project_id: null,
    });
  });

  it("a single-line paste is not intercepted (native paste, no batch preview)", () => {
    renderPalette();
    const input = screen.getByPlaceholderText("Search pages, leads… or type a task, @ to assign");
    pasteInto(input, "Just one task");

    expect(screen.queryByText(/^Create \d+ tasks/)).not.toBeInTheDocument();
  });

  it("on a project page, the batch posts project_id", async () => {
    pathnameRef.current = "/projects/11111111-1111-1111-1111-111111111111";
    const fetchMock = routedFetchMock({
      "/api/v1/my-tasks/bulk": () => ({ data: { created: ["t1", "t2"], failed: 0 } }),
    });
    global.fetch = fetchMock as unknown as typeof fetch;

    renderPalette();
    const input = screen.getByPlaceholderText("Search pages, leads… or type a task, @ to assign");
    pasteInto(input, "Ship it\nTest it");

    await waitFor(() => expect(screen.getByText("Create 2 tasks")).toBeInTheDocument());
    fireEvent.click(screen.getByText("Create 2 tasks"));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(JSON.parse(init.body as string)).toEqual({
      titles: ["Ship it", "Test it"],
      assignee_id: null,
      project_id: "11111111-1111-1111-1111-111111111111",
    });
  });
});
