// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, waitFor, fireEvent, cleanup } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { NotificationsPage } from "./notifications-page";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));

const make = (i: number, unread = true) => ({
  id: `n-${i}`,
  type: "lead.created",
  title: `Notification ${i}`,
  message: `message ${i}`,
  link: `/leads/l-${i}`,
  read_at: unread ? null : "2026-01-01T00:00:00Z",
  created_at: new Date(Date.UTC(2026, 0, 1, 0, 0, 0) - i * 60000).toISOString(),
});

/** Serves `all` (newest first) honouring limit/offset/unread like the real API. */
function serve(all: ReturnType<typeof make>[]) {
  const calls: string[] = [];
  const fn = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(String(input), "http://x");
    calls.push(`${init?.method ?? "GET"} ${url.pathname}${url.search}`);
    if ((init?.method ?? "GET") === "POST") {
      const id = url.pathname.split("/")[4];
      const row = all.find((n) => n.id === id);
      if (row) row.read_at = "2026-01-02T00:00:00Z";
      return Promise.resolve({ ok: true, json: async () => ({ data: {} }) } as Response);
    }
    const limit = Number(url.searchParams.get("limit"));
    const offset = Number(url.searchParams.get("offset") ?? 0);
    const pool = url.searchParams.get("unread") === "true" ? all.filter((n) => !n.read_at) : all;
    return Promise.resolve({
      ok: true,
      json: async () => ({
        data: { notifications: pool.slice(offset, offset + limit), unread_count: all.filter((n) => !n.read_at).length },
      }),
    } as Response);
  });
  return { fn, calls };
}

describe("NotificationsPage", () => {
  const originalFetch = global.fetch;
  afterEach(() => {
    cleanup();
    global.fetch = originalFetch;
  });

  it("shows 25 per page and pages forward with Next", async () => {
    const all = Array.from({ length: 30 }, (_, i) => make(i, false));
    const { fn, calls } = serve(all);
    global.fetch = fn as unknown as typeof fetch;

    render(<NotificationsPage />);
    await waitFor(() => expect(screen.getByText("Notification 0")).toBeInTheDocument());
    expect(screen.getByText("Notification 24")).toBeInTheDocument();
    expect(screen.queryByText("Notification 25")).not.toBeInTheDocument();
    expect(calls[0]).toContain("limit=26&offset=0");

    fireEvent.click(screen.getByRole("button", { name: /next/i }));
    await waitFor(() => expect(screen.getByText("Notification 29")).toBeInTheDocument());
    expect(screen.getByText("Page 2")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /next/i })).toBeDisabled();
  });

  it("no pagination bar when everything fits on one page", async () => {
    const { fn } = serve([make(1, false)]);
    global.fetch = fn as unknown as typeof fetch;

    render(<NotificationsPage />);
    await waitFor(() => expect(screen.getByText("Notification 1")).toBeInTheDocument());
    expect(screen.queryByRole("button", { name: /next/i })).not.toBeInTheDocument();
  });

  it("Unread tab: reading one refetches the page so it stays full (no skipped notifications)", async () => {
    const all = Array.from({ length: 27 }, (_, i) => make(i, true));
    const { fn, calls } = serve(all);
    global.fetch = fn as unknown as typeof fetch;

    render(<NotificationsPage />);
    await waitFor(() => expect(screen.getByText("Notification 0")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: /unread \(27\)/i }));
    await waitFor(() => expect(calls.some((c) => c.includes("unread=true"))).toBe(true));
    await waitFor(() => expect(screen.getByText("Notification 0")).toBeInTheDocument());
    expect(screen.queryByText("Notification 25")).not.toBeInTheDocument();

    fireEvent.click(screen.getAllByRole("button", { name: /mark as read/i })[0]);

    // n-0 is gone and n-25 moved up into page 1 — the page was refetched, not just trimmed.
    await waitFor(() => expect(screen.getByText("Notification 25")).toBeInTheDocument());
    expect(screen.queryByText("Notification 0")).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /unread \(26\)/i })).toBeInTheDocument();
  });

  it("empty Unread tab says so", async () => {
    const { fn } = serve([make(1, false)]);
    global.fetch = fn as unknown as typeof fetch;

    render(<NotificationsPage />);
    await waitFor(() => expect(screen.getByText("Notification 1")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: /unread \(0\)/i }));
    await waitFor(() => expect(screen.getByText(/don't have any unread notifications/i)).toBeInTheDocument());
  });
});
