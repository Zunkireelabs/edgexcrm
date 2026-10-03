// @vitest-environment jsdom
//
// TodayWorklist — the Outreach "Today" list at scale: paged with a TRUE total, rows can be ticked, ticking the page offers
// "select all N matching" (acted on server-side), and the bulk bar offers Send now / Schedule only where EdgeX can send.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, cleanup } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

class ResizeObserverStub {
  observe() {}
  unobserve() {}
  disconnect() {}
}
(global as unknown as { ResizeObserver: typeof ResizeObserverStub }).ResizeObserver = ResizeObserverStub;

// the single-draft panel and the bulk dialog have their own tests — stubs that expose what the list hands them
vi.mock("./draft-review-panel", () => ({
  DraftReviewPanel: ({ draft }: { draft: { subject: string } | null }) => (draft ? <div data-testid="panel">{draft.subject}</div> : null),
}));
const dialogProps = vi.fn();
vi.mock("./bulk-draft-dialog", () => ({
  BulkDraftDialog: (props: Record<string, unknown>) => {
    dialogProps(props);
    return <div data-testid="bulk-dialog">{String(props.action)}</div>;
  },
}));

import { TodayWorklist } from "./today-worklist";

const PAST = new Date(Date.now() - 3600_000).toISOString();
const draft = (n: number) => ({
  id: `d${n}`, lead_id: `l${n}`, step_order: 1, due_at: PAST, subject: `Subject ${n}`, body_html: "", status: "pending", draft_source: "template",
  leads: { first_name: `Lead${n}`, last_name: "Rai", email: `l${n}@x.com` },
  sequence_enrollments: { sequence_id: "s1", status: "active", email_sequences: { name: "Welcome" } },
});

let urls: string[];
let total: number;
let capability: { enabled: boolean; sandbox: boolean };

beforeEach(() => {
  urls = [];
  total = 1234;
  capability = { enabled: true, sandbox: false };
  dialogProps.mockClear();
  globalThis.fetch = vi.fn(async (url: RequestInfo | URL) => {
    const u = String(url);
    urls.push(u);
    if (u.includes("send-capability")) return { ok: true, json: async () => ({ data: capability }) } as Response;
    const page = Number(new URL(u, "http://x").searchParams.get("page") ?? 1);
    const rows = Array.from({ length: 3 }, (_, i) => draft((page - 1) * 3 + i + 1)); // 3 rows a page keeps the test small
    return { ok: true, json: async () => ({ data: rows, meta: { page, pageSize: 50, total, totalPages: Math.max(1, Math.ceil(total / 50)) } }) } as Response;
  }) as typeof fetch;
});
afterEach(cleanup);

const draftUrls = () => urls.filter((u) => u.includes("/outreach/drafts"));

describe("paging", () => {
  it("asks for ONE page and shows the true total — not the length of what was loaded", async () => {
    render(<TodayWorklist isAdmin />);
    await screen.findByText("1,234 due today");
    expect(draftUrls()[0]).toBe("/api/v1/outreach/drafts?due=today&page=1&pageSize=50");
    expect(screen.getByText("Page 1 of 25")).toBeInTheDocument();
    expect(screen.getByText("Lead1 Rai")).toBeInTheDocument();
  });

  it("Next loads the next page; Previous is disabled on page 1", async () => {
    render(<TodayWorklist isAdmin />);
    await screen.findByText("Page 1 of 25");
    expect(screen.getByRole("button", { name: "Previous" })).toBeDisabled();

    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    await screen.findByText("Page 2 of 25");
    expect(draftUrls().at(-1)).toContain("page=2");
    expect(screen.getByText("Lead4 Rai")).toBeInTheDocument();
  });

  it("no pager when everything fits on one page", async () => {
    total = 3;
    render(<TodayWorklist isAdmin />);
    await screen.findByText("3 due today");
    expect(screen.queryByRole("button", { name: "Next" })).toBeNull();
  });

  it("'Show all scheduled' switches the filter and goes back to page 1", async () => {
    render(<TodayWorklist isAdmin />);
    await screen.findByText("Page 1 of 25");
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    await screen.findByText("Page 2 of 25");

    fireEvent.click(screen.getByRole("button", { name: "Show all scheduled" }));
    await screen.findByText("1,234 scheduled");
    expect(draftUrls().at(-1)).toBe("/api/v1/outreach/drafts?due=all&page=1&pageSize=50");
  });

  it("clicking a row still opens the draft", async () => {
    render(<TodayWorklist isAdmin />);
    fireEvent.click(await screen.findByText("Subject 2"));
    expect(screen.getByTestId("panel")).toHaveTextContent("Subject 2");
  });
});

describe("selection and bulk actions", () => {
  it("no bulk bar until something is ticked; ticking rows shows the count", async () => {
    render(<TodayWorklist isAdmin />);
    await screen.findByText("Lead1 Rai");
    expect(screen.queryByRole("region", { name: "Bulk actions" })).toBeNull();

    fireEvent.click(screen.getByLabelText("Select Lead1 Rai"));
    fireEvent.click(screen.getByLabelText("Select Lead2 Rai"));
    expect(screen.getByRole("region", { name: "Bulk actions" })).toHaveTextContent("2 selected");
  });

  it("ticking the whole page offers 'select all 1,234'; taking it acts on EVERY matching draft via the filter", async () => {
    render(<TodayWorklist isAdmin />);
    await screen.findByText("Lead1 Rai");
    fireEvent.click(screen.getByLabelText("Select all on this page"));

    expect(screen.getByText(/All 3 on this page are selected/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Select all 1,234 due today" }));
    expect(screen.getByRole("region", { name: "Bulk actions" })).toHaveTextContent("1,234 selected");
    expect(screen.getByText(/All 1,234 due today are selected, across every page/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /Send now/ }));
    expect(dialogProps).toHaveBeenLastCalledWith(
      expect.objectContaining({ action: "send", count: 1234, selection: { mode: "all", due: "today" }, sandbox: false })
    );
  });

  it("picked rows are sent as ids", async () => {
    render(<TodayWorklist isAdmin />);
    await screen.findByText("Lead1 Rai");
    fireEvent.click(screen.getByLabelText("Select Lead1 Rai"));
    fireEvent.click(screen.getByLabelText("Select Lead3 Rai"));
    fireEvent.click(screen.getByRole("button", { name: "Skip" }));
    expect(dialogProps).toHaveBeenLastCalledWith(expect.objectContaining({ action: "skip", count: 2, selection: { mode: "ids", ids: ["d1", "d3"] } }));
  });

  it("Schedule… opens the schedule dialog", async () => {
    render(<TodayWorklist isAdmin />);
    fireEvent.click(await screen.findByLabelText("Select Lead1 Rai"));
    fireEvent.click(screen.getByRole("button", { name: /Schedule/ }));
    expect(screen.getByTestId("bulk-dialog")).toHaveTextContent("schedule");
  });

  it("the selection is dropped when the page changes (it never silently carries ids from another page)", async () => {
    render(<TodayWorklist isAdmin />);
    fireEvent.click(await screen.findByLabelText("Select Lead1 Rai"));
    expect(screen.getByRole("region", { name: "Bulk actions" })).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    await screen.findByText("Page 2 of 25");
    expect(screen.queryByRole("region", { name: "Bulk actions" })).toBeNull();
  });

  it("Clear drops the selection", async () => {
    render(<TodayWorklist isAdmin />);
    fireEvent.click(await screen.findByLabelText("Select Lead1 Rai"));
    fireEvent.click(screen.getByRole("button", { name: "Clear" }));
    expect(screen.queryByRole("region", { name: "Bulk actions" })).toBeNull();
  });

  it("Send now and Schedule are hidden when EdgeX can't send; Skip is always there", async () => {
    capability = { enabled: false, sandbox: true };
    render(<TodayWorklist isAdmin />);
    fireEvent.click(await screen.findByLabelText("Select Lead1 Rai"));
    await waitFor(() => expect(urls.some((u) => u.includes("send-capability"))).toBe(true));
    expect(screen.queryByRole("button", { name: /Send now/ })).toBeNull();
    expect(screen.queryByRole("button", { name: /Schedule/ })).toBeNull();
    expect(screen.getByRole("button", { name: "Skip" })).toBeInTheDocument();
  });

  it("passes the sandbox flag on so the dialog can warn", async () => {
    capability = { enabled: true, sandbox: true };
    render(<TodayWorklist isAdmin />);
    fireEvent.click(await screen.findByLabelText("Select Lead1 Rai"));
    await waitFor(() => expect(screen.getByRole("button", { name: /Send now/ })).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: /Send now/ }));
    expect(dialogProps).toHaveBeenLastCalledWith(expect.objectContaining({ sandbox: true }));
  });
});
