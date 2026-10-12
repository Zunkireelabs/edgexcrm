// @vitest-environment jsdom
//
// Global Search finds archived leads (education): an "Archived" group under the normal lead results; selecting one opens a
// preview panel (not the lead page) where it can be sent back to the pipeline. Disabled for other industries.

import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { GlobalSearchPalette } from "./global-search-palette";
import type { NavResult } from "./build-nav-index";

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
(global as unknown as { ResizeObserver: typeof ResizeObserverStub }).ResizeObserver = ResizeObserverStub;
if (!Element.prototype.scrollIntoView) Element.prototype.scrollIntoView = () => {};

const routerPush = vi.fn();
const routerRefresh = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: routerPush, refresh: routerRefresh }),
  usePathname: () => "/home",
}));
vi.mock("@/contexts/settings-modal-context", () => ({ useSettingsModal: () => ({ openSettings: vi.fn() }) }));
const toastSuccess = vi.fn();
vi.mock("sonner", () => ({ toast: { success: (...a: unknown[]) => toastSuccess(...a), error: vi.fn() } }));
vi.mock("next/link", () => ({
  default: ({ children, href }: { children: React.ReactNode; href: string }) => <a href={href}>{children}</a>,
}));

const NAV_INDEX: NavResult[] = [
  { id: "leads", label: "Leads", keywords: ["leads"], group: "Pages", icon: "Users", action: { kind: "route", href: "/leads" } },
];

const ARCHIVED = {
  id: "lead-9", first_name: "Abdul", last_name: "Rahim", email: "abdul@example.com", phone: "+977-9800000000",
  archive_reason: "No response", archived_at: "2026-10-05T10:00:00Z", archived_from_list_name: "Qualified",
  assigned_to_name: "Sita Sharma", created_at: "2026-10-01T00:00:00Z", can_open: false, can_restore: true,
};

const originalFetch = global.fetch;
let fetchMock: ReturnType<typeof vi.fn>;
function mockFetch(archived: unknown[] = [ARCHIVED], leads: unknown[] = []) {
  fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (url.startsWith("/api/v1/archived-leads/search")) return { ok: true, status: 200, json: async () => ({ data: archived }) } as Response;
    if (url.includes("/restore") && init?.method === "POST") return { ok: true, status: 200, json: async () => ({ data: { list_name: "Qualified" } }) } as Response;
    if (url.startsWith("/api/v1/leads")) return { ok: true, status: 200, json: async () => ({ data: leads }) } as Response;
    return { ok: true, status: 200, json: async () => ({ data: [] }) } as Response;
  });
  global.fetch = fetchMock as unknown as typeof fetch;
}
const archivedCalls = () => fetchMock.mock.calls.filter(([u]) => String(u).startsWith("/api/v1/archived-leads/search"));

function renderPalette(props: Partial<React.ComponentProps<typeof GlobalSearchPalette>> = {}) {
  const onClose = vi.fn();
  render(<GlobalSearchPalette isOpen onClose={onClose} navIndex={NAV_INDEX} currentUserId="u-1" archivedLookupEnabled {...props} />);
  return { onClose };
}
const type = (value: string) =>
  fireEvent.change(screen.getByPlaceholderText("Search pages, leads… or type a task, @ to assign"), { target: { value } });

afterEach(() => {
  cleanup();
  global.fetch = originalFetch;
  vi.clearAllMocks();
});

describe("Global Search — archived leads", () => {
  it("shows matching archived leads in their own 'Archived' group, with a badge and the reason", async () => {
    mockFetch();
    renderPalette();
    type("abdul");
    await screen.findByText("Archived", { selector: "[cmdk-group-heading]" });
    expect(screen.getByText("Abdul Rahim")).toBeInTheDocument();
    expect(screen.getByText("Reason: No response")).toBeInTheDocument();
    expect(archivedCalls()[0][0]).toBe("/api/v1/archived-leads/search?q=abdul");
  });

  it("still shows the normal lead results alongside", async () => {
    mockFetch([ARCHIVED], [{ id: "lead-1", first_name: "Anil", last_name: "Rai", email: "anil@x.com", phone: null }]);
    renderPalette();
    type("abdul");
    await screen.findByText("Anil Rai");
    await screen.findByText("Abdul Rahim");
  });

  it("does not search archived leads for a query under 3 characters", async () => {
    mockFetch();
    renderPalette();
    type("ab");
    await waitFor(() => expect(fetchMock.mock.calls.some(([u]) => String(u).startsWith("/api/v1/leads"))).toBe(true));
    expect(archivedCalls()).toHaveLength(0);
  });

  it("never searches archived leads for tenants that do not have the feature", async () => {
    mockFetch();
    renderPalette({ archivedLookupEnabled: false });
    type("abdul");
    await waitFor(() => expect(fetchMock.mock.calls.some(([u]) => String(u).startsWith("/api/v1/leads"))).toBe(true));
    expect(archivedCalls()).toHaveLength(0);
    expect(screen.queryByText("Abdul Rahim")).toBeNull();
  });

  it("selecting an archived lead closes the palette and opens the preview — it does NOT go to the lead page", async () => {
    mockFetch();
    const { onClose } = renderPalette();
    type("abdul");
    fireEvent.click(await screen.findByText("Abdul Rahim"));
    expect(onClose).toHaveBeenCalled();
    expect(routerPush).not.toHaveBeenCalled();
    expect(await screen.findByRole("button", { name: /Move back to pipeline/ })).toBeInTheDocument();
    expect(screen.getByText("Sita Sharma")).toBeInTheDocument();
  });

  it("restoring from the preview POSTs it, tells the user, and refreshes the page", async () => {
    mockFetch();
    renderPalette();
    type("abdul");
    fireEvent.click(await screen.findByText("Abdul Rahim"));
    fireEvent.click(await screen.findByRole("button", { name: /Move back to pipeline/ }));
    await waitFor(() => expect(toastSuccess).toHaveBeenCalledWith("Abdul Rahim moved back to Qualified"));
    expect(fetchMock).toHaveBeenCalledWith("/api/v1/archived-leads/lead-9/restore", { method: "POST" });
    expect(routerRefresh).toHaveBeenCalled();
  });

  it("an empty search with archived matches does not show the 'no results' message", async () => {
    mockFetch([ARCHIVED], []);
    renderPalette();
    type("zzzq");
    await screen.findByText("Abdul Rahim");
    expect(screen.queryByText(/No results for/)).toBeNull();
  });
});
