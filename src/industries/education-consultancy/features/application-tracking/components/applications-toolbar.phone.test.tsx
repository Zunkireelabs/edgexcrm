// @vitest-environment jsdom

// EDGEX-141 Phase 5: the Applications toolbar below md (search chip -> input, query chip, sheets).

import { describe, it, expect, vi, afterEach, beforeAll } from "vitest";
import { render, screen, fireEvent, cleanup, within } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { ApplicationsToolbar, type ApplicationsToolbarProps } from "./applications-toolbar";
import type { FieldDef } from "@/lib/filters/types";

function setPhone(matches: boolean) {
  Object.defineProperty(window, "matchMedia", {
    configurable: true,
    writable: true,
    value: () => ({ matches, media: "", addEventListener: () => {}, removeEventListener: () => {} }),
  });
}

const FIELD = { key: "offer_type", label: "Offer type", type: "select", filterable: true, options: [{ value: "conditional", label: "Conditional" }] } as unknown as FieldDef;

function props(o: Partial<ApplicationsToolbarProps> = {}): ApplicationsToolbarProps {
  return {
    tab: "all",
    tabCounts: { all: 72, mine: 3, stuck: 0 },
    onTab: vi.fn(),
    q: "",
    onSearch: vi.fn(),
    sort: "time_in_stage" as ApplicationsToolbarProps["sort"],
    onSort: vi.fn(),
    fields: [FIELD],
    tree: { conjunction: "and", conditions: [] },
    onTreeChange: vi.fn(),
    optionCtx: { getOptions: (f: FieldDef) => (f.options ?? []).map((x) => ({ value: x.value, label: x.label })), countSources: {} },
    mostUsedKeys: ["offer_type"],
    filterError: null,
    columnWidth: "wide",
    onColumnWidth: vi.fn(),
    view: "board",
    onView: vi.fn(),
    ...o,
  };
}

beforeAll(() => {
  (Element.prototype as unknown as { scrollIntoView: () => void }).scrollIntoView = () => {};
});
afterEach(() => cleanup());

describe("ApplicationsToolbar below md", () => {
  it("short tab labels and an icon Board/List toggle in the tabs row", () => {
    setPhone(true);
    const onView = vi.fn();
    render(<ApplicationsToolbar {...props({ onView })} />);
    expect(screen.getByTestId("applications-tab-all")).toHaveTextContent("All");
    expect(screen.getByTestId("applications-tab-mine")).toHaveTextContent("Mine");
    fireEvent.click(screen.getByTestId("view-list-phone"));
    expect(onView).toHaveBeenCalledWith("list");
  });

  it("search chip -> 36px input; Enter commits ?q= at once; the query then shows as a chip whose × clears it", () => {
    setPhone(true);
    const onSearch = vi.fn();
    const { rerender } = render(<ApplicationsToolbar {...props({ onSearch })} />);
    fireEvent.click(screen.getByTestId("applications-search-chip"));
    const input = screen.getByTestId("applications-search-phone");
    expect(screen.queryByTestId("applications-chip-row")).toBeNull(); // the row turned into the input
    fireEvent.change(input, { target: { value: " sita " } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onSearch).toHaveBeenLastCalledWith("sita");
    rerender(<ApplicationsToolbar {...props({ onSearch, q: "sita" })} />);
    const chip = screen.getByTestId("applications-query-chip");
    expect(chip).toHaveTextContent("“sita”");
    expect(screen.queryByTestId("applications-search-chip")).toBeNull();
    fireEvent.click(within(chip).getByLabelText("Clear search"));
    expect(onSearch).toHaveBeenLastCalledWith("");
  });

  it("Cancel clears the query and closes the input", () => {
    setPhone(true);
    const onSearch = vi.fn();
    render(<ApplicationsToolbar {...props({ onSearch, q: "sita" })} />);
    fireEvent.click(screen.getByLabelText("Edit search"));
    fireEvent.click(screen.getByTestId("applications-search-cancel"));
    expect(onSearch).toHaveBeenLastCalledWith("");
    expect(screen.queryByTestId("applications-search-phone")).toBeNull();
  });

  it("Sort and Filter open as bottom sheets with the same rows; picking a sort closes it", () => {
    setPhone(true);
    const onSort = vi.fn();
    render(<ApplicationsToolbar {...props({ onSort })} />);
    expect(screen.getByTestId("applications-sort-trigger")).not.toHaveAttribute("aria-haspopup");
    fireEvent.click(screen.getByTestId("applications-sort-trigger"));
    const sortSheet = screen.getByTestId("applications-sort-sheet");
    expect(sortSheet).toHaveTextContent("Sort by");
    fireEvent.click(within(sortSheet).getAllByRole("option")[0]);
    expect(onSort).toHaveBeenCalled();
    expect(screen.queryByTestId("applications-sort-sheet")).toBeNull();

    fireEvent.click(screen.getByTestId("applications-filter-trigger"));
    const filterSheet = screen.getByTestId("applications-filter-trigger-sheet");
    expect(filterSheet).toHaveTextContent("Filter by");
    fireEvent.click(within(filterSheet).getByRole("option", { name: /Offer type/ }));
    expect(screen.getByTestId("applications-filter-trigger-sheet")).toHaveTextContent("Conditional");
    fireEvent.click(screen.getByLabelText("Back to fields"));
    expect(screen.getByTestId("applications-filter-trigger-sheet")).toHaveTextContent("Filter by");
  });

  it("md and up: popovers (no sheets), the desktop search field and segmented Board/List", () => {
    setPhone(false);
    render(<ApplicationsToolbar {...props()} />);
    expect(screen.getByTestId("applications-sort-trigger")).toHaveAttribute("aria-haspopup", "dialog");
    expect(screen.getByTestId("applications-filter-trigger")).toHaveAttribute("aria-haspopup", "dialog");
    expect(screen.getByTestId("applications-search")).toBeInTheDocument();
    expect(screen.getByTestId("view-board")).toHaveTextContent("Board");
  });
});
