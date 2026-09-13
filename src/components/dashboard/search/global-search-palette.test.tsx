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
    const input = screen.getByPlaceholderText("Search pages, leads…");
    fireEvent.change(input, { target: { value: "Fix the login bug" } });

    expect(screen.getByText('Create task “Fix the login bug”')).toBeInTheDocument();
  });

  it("a query matching a nav item does not surface the action row", () => {
    renderPalette();
    const input = screen.getByPlaceholderText("Search pages, leads…");
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
    const input = screen.getByPlaceholderText("Search pages, leads…");
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
    const input = screen.getByPlaceholderText("Search pages, leads…");
    fireEvent.change(input, { target: { value: "Ship it" } });
    fireEvent.click(screen.getByText('Create task “Ship it”'));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("/api/v1/projects/11111111-1111-1111-1111-111111111111/tasks");
    expect(JSON.parse(init.body as string)).toEqual({ title: "Ship it", assignee_id: "user-1" });
  });
});
