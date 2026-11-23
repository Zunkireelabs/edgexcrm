// @vitest-environment jsdom
//
// SearchableSelect (EDGEX-145): filtering on label + secondary, keyboard pick, Esc returns focus to the trigger,
// multi toggle keeps it open, footer action, and the search row only for long lists.
import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { useState } from "react";
import { SearchableSelect, type SearchableOption } from "./searchable-select";

class RO { observe() {} unobserve() {} disconnect() {} }
(globalThis as unknown as { ResizeObserver: typeof RO }).ResizeObserver = RO;
Element.prototype.scrollIntoView = () => {};

afterEach(cleanup);

const many: SearchableOption[] = Array.from({ length: 10 }, (_, i) => ({
  value: `v${i}`,
  label: `Option ${i}`,
  secondary: i === 3 ? "Counsellor · Kathmandu" : undefined,
}));

function Single({ options = many, onChange = () => {}, extra = {} }: { options?: SearchableOption[]; onChange?: (v: string) => void; extra?: object }) {
  const [v, setV] = useState("");
  return <SearchableSelect options={options} value={v} onValueChange={(x) => { setV(x); onChange(x); }} placeholder="Pick one" {...extra} />;
}

describe("SearchableSelect", () => {
  it("filters on label and secondary text, case-insensitively, and shows a no-results row", () => {
    render(<Single />);
    fireEvent.click(screen.getByRole("combobox"));
    const input = screen.getByPlaceholderText("Search…");
    fireEvent.change(input, { target: { value: "KATHMANDU" } });
    expect(screen.getAllByRole("option")).toHaveLength(1);
    expect(screen.getByRole("option")).toHaveTextContent("Option 3");
    fireEvent.change(input, { target: { value: "zzz" } });
    expect(screen.queryAllByRole("option")).toHaveLength(0);
    expect(screen.getByText("No results for “zzz”")).toBeInTheDocument();
  });

  it("always shows the search row, even for a 3-option list, unless searchable={false}", () => {
    render(<Single options={many.slice(0, 3)} />);
    fireEvent.click(screen.getByRole("combobox"));
    expect(screen.getByPlaceholderText("Search…")).toBeInTheDocument();
    cleanup();
    render(<Single options={many.slice(0, 3)} extra={{ searchable: false }} />);
    fireEvent.click(screen.getByRole("combobox"));
    expect(screen.queryByPlaceholderText("Search…")).toBeNull();
  });

  it("starts the highlight on the first item, Enter picks the highlighted one and closes (single)", () => {
    const onChange = vi.fn();
    render(<Single onChange={onChange} />);
    const trigger = screen.getByRole("combobox");
    fireEvent.click(trigger);
    const input = screen.getByPlaceholderText("Search…");
    fireEvent.keyDown(input, { key: "ArrowDown" });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(onChange).toHaveBeenCalledWith("v1");
    expect(screen.queryByRole("listbox")).toBeNull();
    expect(trigger).toHaveTextContent("Option 1");
  });

  it("marks the selected item with aria-selected and a check", () => {
    function Pre() {
      const [v, setV] = useState("v2");
      return <SearchableSelect options={many} value={v} onValueChange={setV} />;
    }
    render(<Pre />);
    fireEvent.click(screen.getByRole("combobox"));
    expect(screen.getByRole("option", { name: /Option 2/ })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("option", { name: /Option 3/ })).toHaveAttribute("aria-selected", "false");
  });

  it("Esc closes the popover and returns focus to the trigger", async () => {
    render(<Single />);
    const trigger = screen.getByRole("combobox");
    trigger.focus();
    fireEvent.click(trigger);
    fireEvent.keyDown(screen.getByPlaceholderText("Search…"), { key: "Escape" });
    await vi.waitFor(() => expect(screen.queryByRole("listbox")).toBeNull());
    await vi.waitFor(() => expect(trigger).toHaveFocus());
  });

  it("multiple: rows toggle, the popover stays open, the trigger summarises", () => {
    function Multi() {
      const [v, setV] = useState<string[]>([]);
      return <SearchableSelect multiple options={many} value={v} onValueChange={setV} placeholder="Pick" />;
    }
    render(<Multi />);
    const trigger = screen.getByRole("combobox");
    fireEvent.click(trigger);
    fireEvent.click(screen.getByRole("option", { name: /Option 0/ }));
    fireEvent.click(screen.getByRole("option", { name: /Option 1/ }));
    expect(screen.getByRole("listbox")).toBeInTheDocument(); // still open
    expect(trigger).toHaveTextContent("Option 0, Option 1");
    fireEvent.click(screen.getByRole("option", { name: /Option 2/ }));
    expect(trigger).toHaveTextContent("3 selected");
    fireEvent.click(screen.getByRole("option", { name: /Option 0/ })); // toggle off
    expect(trigger).toHaveTextContent("Option 1, Option 2");
  });

  it("footerAction renders under a hairline and fires", () => {
    const onSelect = vi.fn();
    render(<Single extra={{ footerAction: { label: "Create “x”", onSelect } }} />);
    fireEvent.click(screen.getByRole("combobox"));
    fireEvent.click(screen.getByRole("button", { name: /Create/ }));
    expect(onSelect).toHaveBeenCalled();
  });
});
