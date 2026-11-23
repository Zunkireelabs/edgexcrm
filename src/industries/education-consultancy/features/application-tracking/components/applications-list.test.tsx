// @vitest-environment jsdom

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup, waitFor, within, act } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";

const toastMock = vi.hoisted(() => ({ success: vi.fn(), error: vi.fn() }));
const pushMock = vi.hoisted(() => vi.fn());
vi.mock("sonner", () => ({ toast: toastMock }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: pushMock, refresh: vi.fn(), replace: vi.fn() }) }));

import { ApplicationsList, type ApplicationsListProps, type ListPage } from "./applications-list";
import { LIST_DEFAULT_KEYS } from "../lib/list-view";
import type { Application, ApplicationStage } from "@/types/database";

// Radix popovers measure the anchor; jsdom has no layout.
class RO {
  observe() {}
  unobserve() {}
  disconnect() {}
}
(globalThis as unknown as { ResizeObserver: typeof RO }).ResizeObserver = RO;

const stage = (o: Partial<ApplicationStage>): ApplicationStage =>
  ({ tenant_id: "t", slug: "s", created_at: "", updated_at: "", is_default: false, is_terminal: false, terminal_type: null, color: "#266df0", pipeline_id: "p1", position: 0, ...o }) as ApplicationStage;
const STAGES = [
  stage({ id: "s1", name: "Need to start" }),
  stage({ id: "s2", name: "Applied", position: 1 }),
  stage({ id: "s3", name: "Enrolled", position: 2, is_terminal: true, terminal_type: "won" }),
];
const DAY = 86_400_000;
const app = (i: number, o: Partial<Application> = {}): Application =>
  ({
    id: `a${i}`, tenant_id: "t", lead_id: `l${i}`, assigned_to: i % 2 ? "u1" : null, created_by: null, university_name: `Uni ${i}`, program_name: `Prog ${i}`,
    intake_term: "Sep 2026", country: null, countries: ["UK"], pipeline_id: "p1", stage_id: "s1", status: "x", offer_type: null,
    application_deadline: null, application_fee_paid: false, tuition_fee: null, deposit_paid: false, offer_letter_url: null, notes: null, agent_id: null,
    applied_date: null, intake_start_date: null, degree_level: null, field_of_study: null, created_at: new Date().toISOString(), updated_at: new Date().toISOString(),
    stage_changed_at: new Date(Date.now() - i * 5 * DAY).toISOString(), deleted_at: null, doc_count: i, open_task_count: 0,
    leads: { id: `l${i}`, first_name: "Student", last_name: String(i), email: null, assigned_to: "u2" },
    ...o,
  }) as Application;

const ROWS = Array.from({ length: 30 }, (_, i) => app(i));
const SUMMARY = { applications: 30, universities: 30, stages: 1, medianDaysInStage: 72, counsellors: 2, dueSoon: 3 };

function makeFetchPage(rows = ROWS) {
  return vi.fn(async (offset: number, limit: number): Promise<ListPage> => ({ rows: rows.slice(offset, offset + limit), total: rows.length, summary: SUMMARY, truncated: false }));
}

function props(o: Partial<ApplicationsListProps> = {}): ApplicationsListProps {
  return {
    stateQuery: "",
    fetchPage: makeFetchPage(),
    page: 1,
    pageSize: 25,
    onPage: vi.fn(),
    onPageSize: vi.fn(),
    layout: { keys: LIST_DEFAULT_KEYS, pins: [] },
    onLayoutChange: vi.fn(),
    sort: "stage",
    onSort: vi.fn(),
    onFilterRequest: vi.fn(),
    filterFieldKeys: new Set(["stage", "university", "counsellor", "student"]),
    stages: STAGES,
    teamMembers: [{ user_id: "u1", name: "Asha Tamang", email: "a@x.test" }, { user_id: "u2", name: "Binod Rai", email: "b@x.test" }],
    assigneeNames: { u1: "Asha Tamang", u2: "Binod Rai" },
    canManageApplications: true,
    bulkAllowed: true,
    timezone: "UTC",
    detailHref: (id) => `/applications/${id}`,
    filtersActive: false,
    onClearFilters: vi.fn(),
    onChanged: vi.fn(),
    ...o,
  };
}

const rowsShown = () => screen.queryAllByTestId("list-row");

beforeEach(() => {
  toastMock.success.mockReset();
  toastMock.error.mockReset();
  pushMock.mockReset();
});
afterEach(cleanup);

describe("ApplicationsList", () => {
  it("renders the page, the default columns, footer summaries and Leads-style paging", async () => {
    render(<ApplicationsList {...props()} />);
    await waitFor(() => expect(rowsShown()).toHaveLength(25));
    expect(screen.getByTestId("list-showing")).toHaveTextContent("Showing 1–25 of 30");
    expect(screen.getByText("Page 1 of 2")).toBeInTheDocument();
    for (const k of LIST_DEFAULT_KEYS) expect(screen.getByTestId(`column-header-${k}`)).toBeInTheDocument();
    expect(screen.getByTestId("footer-student")).toHaveTextContent("30 applications");
    expect(screen.getByTestId("footer-university")).toHaveTextContent("30 universities");
    expect(screen.getByTestId("footer-stage")).toHaveTextContent("1 stage");
    expect(screen.getByTestId("footer-time_in_stage")).toHaveTextContent("72d median");
    expect(screen.getByTestId("footer-counsellor")).toHaveTextContent("2 counsellors");
    expect(screen.getByTestId("footer-deadline")).toHaveTextContent("3 due in 14d");
    // Rows per page offers 25 / 50 / 100 only
    const select = screen.getByRole("combobox");
    expect([...(select as HTMLSelectElement).options].map((o) => o.value)).toEqual(["25", "50", "100"]);
  });

  it("cells: effective counsellor (application, else lead), age tone, deadline tone, stage", async () => {
    const rows = [
      app(1, { assigned_to: "u1", stage_changed_at: new Date(Date.now() - 31 * DAY).toISOString(), application_deadline: "2000-01-01" }),
      app(2, { assigned_to: null, stage_changed_at: new Date(Date.now() - 15 * DAY).toISOString(), application_deadline: new Date(Date.now() + 3 * DAY).toISOString().slice(0, 10) }),
      app(3, { assigned_to: null, leads: { id: "l3", first_name: "No", last_name: "One", email: null, assigned_to: null }, stage_id: "s3", stage_changed_at: new Date(Date.now() - 90 * DAY).toISOString() }),
    ];
    render(<ApplicationsList {...props({ fetchPage: makeFetchPage(rows) })} />);
    await waitFor(() => expect(rowsShown()).toHaveLength(3));
    const [r1, r2, r3] = rowsShown();
    expect(r1).toHaveTextContent("Asha Tamang");
    expect(within(r1).getByTestId("age-pill")).toHaveAttribute("data-tone", "red");
    expect(within(r1).getByTestId("deadline")).toHaveAttribute("data-tone", "past");
    expect(r2).toHaveTextContent("Binod Rai");
    expect(within(r2).getByTestId("age-pill")).toHaveAttribute("data-tone", "amber");
    expect(within(r2).getByTestId("deadline")).toHaveAttribute("data-tone", "soon");
    expect(r3).toHaveTextContent("Set counsellor");
    expect(within(r3).getByTestId("age-pill")).toHaveAttribute("data-tone", "neutral"); // finished stage
    expect(r3).toHaveTextContent("Enrolled");
    expect(within(r3).getByTestId("deadline")).toHaveTextContent("—");
  });

  it("read-only users see the stage without the picker, and no checkboxes or bulk bar", async () => {
    render(<ApplicationsList {...props({ canManageApplications: false, bulkAllowed: false })} />);
    await waitFor(() => expect(rowsShown()).toHaveLength(25));
    expect(screen.queryAllByTestId("stage-cell")).toHaveLength(0);
    expect(screen.getAllByTestId("stage-cell-readonly")).toHaveLength(25);
    expect(screen.queryAllByRole("checkbox")).toHaveLength(0);
  });

  it("the Stage cell opens Move to stage: active stages, then Finished, current checked", async () => {
    render(<ApplicationsList {...props()} />);
    await waitFor(() => expect(rowsShown()).toHaveLength(25));
    fireEvent.click(screen.getAllByTestId("stage-cell")[0]);
    const picker = await screen.findByTestId("row-stage-picker");
    const opts = within(picker).getAllByRole("option").map((o) => o.textContent);
    expect(opts).toEqual(["Need to start", "Applied", "Enrolled"]);
    expect(within(picker).getByText("Finished")).toBeInTheDocument();
    expect(within(picker).getAllByRole("option")[0]).toHaveAttribute("aria-selected", "true");
  });

  it("inline move: one PATCH with stage_id, then a refresh", async () => {
    const fetchImpl = vi.fn(async () => ({ ok: true }) as Response);
    const p = props({ fetchImpl: fetchImpl as unknown as typeof fetch });
    render(<ApplicationsList {...p} />);
    await waitFor(() => expect(rowsShown()).toHaveLength(25));
    fireEvent.click(screen.getAllByTestId("stage-cell")[0]);
    fireEvent.click(within(await screen.findByTestId("row-stage-picker")).getByText("Applied"));
    await waitFor(() => expect(fetchImpl).toHaveBeenCalledTimes(1));
    expect(fetchImpl).toHaveBeenCalledWith("/api/v1/applications/a0", expect.objectContaining({ method: "PATCH", body: JSON.stringify({ stage_id: "s2" }) }));
    await waitFor(() => expect(p.onChanged).toHaveBeenCalled());
    expect(toastMock.success).toHaveBeenCalledWith("Moved to Applied");
  });

  it("the header checkbox selects the current page only; the bulk bar reads 'N selected · Move stage · Assign counsellor · Clear'", async () => {
    render(<ApplicationsList {...props()} />);
    await waitFor(() => expect(rowsShown()).toHaveLength(25));
    fireEvent.click(screen.getByLabelText("Select all on this page"));
    const bar = await screen.findByTestId("list-bulk-bar");
    expect(bar).toHaveTextContent("25 selected");
    expect(within(bar).getAllByRole("button").map((b) => b.textContent)).toEqual(["Move stage", "Assign counsellor", "Clear"]);
    expect(within(bar).queryByText(/delete/i)).toBeNull();
    expect(rowsShown().every((r) => r.getAttribute("data-state") === "selected")).toBe(true);
    fireEvent.click(within(bar).getByText("Clear"));
    expect(screen.queryByTestId("list-bulk-bar")).toBeNull();
  });

  it("changing page clears the selection", async () => {
    const p = props();
    const { rerender } = render(<ApplicationsList {...p} />);
    await waitFor(() => expect(rowsShown()).toHaveLength(25));
    fireEvent.click(screen.getByLabelText("Select Student 1"));
    expect(screen.getByTestId("list-bulk-bar")).toHaveTextContent("1 selected");
    rerender(<ApplicationsList {...p} page={2} />);
    await waitFor(() => expect(rowsShown()).toHaveLength(5));
    expect(screen.queryByTestId("list-bulk-bar")).toBeNull();
  });

  it("bulk partial failure: 'N of M updated', the failed rows stay selected", async () => {
    const fetchImpl = vi.fn(async (url: string) => ({ ok: !url.endsWith("/a2") }) as Response);
    render(<ApplicationsList {...props({ fetchImpl: fetchImpl as unknown as typeof fetch })} />);
    await waitFor(() => expect(rowsShown()).toHaveLength(25));
    for (const n of [1, 2, 3]) fireEvent.click(screen.getByLabelText(`Select Student ${n}`));
    fireEvent.click(within(screen.getByTestId("list-bulk-bar")).getByText("Move stage"));
    fireEvent.click(within(await screen.findByTestId("bulk-stage-picker")).getByText("Applied"));
    await waitFor(() => expect(toastMock.error).toHaveBeenCalledWith("2 of 3 updated"));
    expect(fetchImpl).toHaveBeenCalledTimes(3);
    await waitFor(() => expect(screen.getByTestId("list-bulk-bar")).toHaveTextContent("1 selected"));
    expect(rowsShown().find((r) => r.getAttribute("data-app-id") === "a2")).toHaveAttribute("data-state", "selected");
  });

  it("bulk Assign counsellor: members + 'No counsellor (use the student's)', which sends assigned_to null", async () => {
    const fetchImpl = vi.fn(async () => ({ ok: true }) as Response);
    render(<ApplicationsList {...props({ fetchImpl: fetchImpl as unknown as typeof fetch })} />);
    await waitFor(() => expect(rowsShown()).toHaveLength(25));
    fireEvent.click(screen.getByLabelText("Select Student 4"));
    fireEvent.click(within(screen.getByTestId("list-bulk-bar")).getByText("Assign counsellor"));
    const picker = await screen.findByTestId("bulk-assign-picker");
    // the option label (the leading avatar holds initials)
    expect(within(picker).getAllByRole("option").map((o) => o.querySelector(".truncate")?.textContent)).toEqual(["No counsellor (use the student's)", "Asha Tamang", "Binod Rai"]);
    fireEvent.click(within(picker).getByText("No counsellor (use the student's)"));
    await waitFor(() => expect(fetchImpl).toHaveBeenCalledWith("/api/v1/applications/a4", expect.objectContaining({ body: JSON.stringify({ assigned_to: null }) })));
    await waitFor(() => expect(toastMock.success).toHaveBeenCalledWith("1 application updated"));
  });

  it("column menu: sort both ways maps to the explicit sort values; Filter by asks the toolbar; Hide drops the column", async () => {
    const p = props();
    render(<ApplicationsList {...p} />);
    await waitFor(() => expect(rowsShown()).toHaveLength(25));
    fireEvent.click(screen.getByTestId("column-header-university"));
    let menu = await screen.findByTestId("column-header-menu");
    expect(within(menu).queryByText("Pin column")).toBeNull();
    expect(within(menu).queryByText("Rename column")).toBeNull();
    fireEvent.click(within(menu).getByText("Sort descending"));
    expect(p.onSort).toHaveBeenCalledWith("university_desc");
    await act(async () => new Promise((r) => setTimeout(r, 300)));
    fireEvent.click(screen.getByTestId("column-header-time_in_stage"));
    menu = await screen.findByTestId("column-header-menu");
    fireEvent.click(within(menu).getByText("Sort ascending"));
    expect(p.onSort).toHaveBeenCalledWith("stage_asc");
    await act(async () => new Promise((r) => setTimeout(r, 300)));
    fireEvent.click(screen.getByTestId("column-header-stage"));
    menu = await screen.findByTestId("column-header-menu");
    expect(within(menu).queryByText("Sort ascending")).toBeNull(); // Stage isn't sortable
    fireEvent.click(within(menu).getByText("Filter by Stage"));
    expect(p.onFilterRequest).toHaveBeenCalledWith("stage");
    await act(async () => new Promise((r) => setTimeout(r, 300)));
    fireEvent.click(screen.getByTestId("column-header-docs"));
    fireEvent.click(within(await screen.findByTestId("column-header-menu")).getByText("Hide from view"));
    expect(p.onLayoutChange).toHaveBeenCalledWith({ keys: LIST_DEFAULT_KEYS.filter((k) => k !== "docs"), pins: [] });
  });

  it("⌘↵ opens the hovered row's detail page", async () => {
    render(<ApplicationsList {...props()} />);
    await waitFor(() => expect(rowsShown()).toHaveLength(25));
    fireEvent.mouseEnter(rowsShown()[3]);
    fireEvent.keyDown(window, { key: "Enter", metaKey: true });
    expect(pushMock).toHaveBeenCalledWith("/applications/a3");
  });

  it("no results: the no-matches state with Clear filters, inside the table area; paging reads 0 of 0", async () => {
    const p = props({ fetchPage: makeFetchPage([]), filtersActive: true });
    render(<ApplicationsList {...p} />);
    await waitFor(() => expect(screen.getByTestId("list-no-matches")).toBeInTheDocument());
    expect(screen.getByText("No applications match these filters")).toBeInTheDocument();
    fireEvent.click(screen.getByTestId("list-clear-filters"));
    expect(p.onClearFilters).toHaveBeenCalled();
    expect(screen.getByTestId("list-showing")).toHaveTextContent("Showing 0 of 0");
  });

  it("a ?page= past the end goes to the last real page", async () => {
    const p = props({ page: 9 });
    render(<ApplicationsList {...p} />);
    await waitFor(() => expect(p.onPage).toHaveBeenCalledWith(2));
  });
});

// EDGEX-141 Phase 5: below md the List is stacked 72px rows, not a table.
describe("ApplicationsList phone (below md)", () => {
  const ymd = (offsetDays: number) => new Date(Date.now() + offsetDays * DAY).toISOString().slice(0, 10);

  it("renders rows, not a table: no checkboxes, bulk bar, column menu, footer or page-size picker", async () => {
    render(<ApplicationsList {...props({ phone: true })} />);
    await waitFor(() => expect(screen.getAllByTestId("list-phone-row")).toHaveLength(25));
    expect(document.querySelector("table")).toBeNull();
    expect(screen.queryAllByRole("checkbox")).toHaveLength(0);
    expect(screen.queryByTestId("list-bulk-bar")).toBeNull();
    expect(screen.queryByTestId("list-footer")).toBeNull();
    expect(screen.queryByTestId("column-header-student")).toBeNull();
    expect(screen.queryByRole("combobox")).toBeNull();
    expect(rowsShown()).toHaveLength(0);
  });

  it("each row: student + age pill, university · program, stage + deadline + counsellor; tap opens the detail", async () => {
    const rows = [
      app(0, { assigned_to: "u1", application_deadline: ymd(9), stage_changed_at: new Date(Date.now() - 17 * DAY).toISOString() }),
      app(1, { assigned_to: null, leads: { id: "l1", first_name: "Priya", last_name: "Magar", email: null, assigned_to: null } as Application["leads"], application_deadline: ymd(-2), stage_changed_at: new Date(Date.now() - 33 * DAY).toISOString() }),
      app(2, { application_deadline: ymd(40), stage_id: "s2" }),
      app(3, { application_deadline: null }),
    ];
    render(<ApplicationsList {...props({ phone: true, fetchPage: makeFetchPage(rows) })} />);
    await waitFor(() => expect(screen.getAllByTestId("list-phone-row")).toHaveLength(4));
    const [r0, r1, r2, r3] = screen.getAllByTestId("list-phone-row");
    expect(r0).toHaveAttribute("href", "/applications/a0");
    expect(r0).toHaveTextContent("Student 0");
    expect(r0).toHaveTextContent("Uni 0 · Prog 0");
    expect(r0).toHaveTextContent("Need to start");
    expect(r0).toHaveTextContent("Asha Tamang");
    expect(within(r0).getByTestId("age-pill")).toHaveAttribute("data-tone", "amber");
    expect(within(r0).getByTestId("deadline")).toHaveAttribute("data-tone", "soon");
    expect(within(r0).getByTestId("deadline")).toHaveTextContent("Deadline in 9d");
    expect(r1).toHaveTextContent("Set counsellor");
    expect(within(r1).getByTestId("age-pill")).toHaveAttribute("data-tone", "red");
    expect(within(r1).getByTestId("deadline")).toHaveAttribute("data-tone", "past");
    expect(within(r1).getByTestId("deadline")).toHaveTextContent("Deadline passed");
    expect(r2).toHaveTextContent("Applied");
    expect(within(r2).getByTestId("deadline")).toHaveAttribute("data-tone", "neutral");
    expect(within(r3).queryByTestId("deadline")).toBeNull();
  });

  it("sticky pager '1–25 of 30' with prev/next on the same server paging and stored page size", async () => {
    const fetchPage = makeFetchPage();
    const onPage = vi.fn();
    const { rerender } = render(<ApplicationsList {...props({ phone: true, fetchPage, onPage })} />);
    await waitFor(() => expect(screen.getByTestId("list-showing")).toHaveTextContent("1–25 of 30"));
    expect(fetchPage).toHaveBeenLastCalledWith(0, 25);
    expect(screen.getByLabelText("Previous page")).toBeDisabled();
    fireEvent.click(screen.getByLabelText("Next page"));
    expect(onPage).toHaveBeenCalledWith(2);
    rerender(<ApplicationsList {...props({ phone: true, fetchPage, onPage, page: 2 })} />);
    await waitFor(() => expect(screen.getByTestId("list-showing")).toHaveTextContent("26–30 of 30"));
    expect(fetchPage).toHaveBeenLastCalledWith(25, 25);
    expect(screen.getByLabelText("Next page")).toBeDisabled();
    rerender(<ApplicationsList {...props({ phone: true, fetchPage, onPage, page: 1, pageSize: 50 })} />);
    await waitFor(() => expect(fetchPage).toHaveBeenLastCalledWith(0, 50));
  });

  it("no results: the no-matches state with Clear filters, no pager", async () => {
    const onClearFilters = vi.fn();
    render(<ApplicationsList {...props({ phone: true, fetchPage: makeFetchPage([]), filtersActive: true, onClearFilters })} />);
    await screen.findByTestId("list-no-matches");
    expect(screen.queryByTestId("list-phone-pager")).toBeNull();
    fireEvent.click(screen.getByTestId("list-clear-filters"));
    expect(onClearFilters).toHaveBeenCalled();
  });
});
