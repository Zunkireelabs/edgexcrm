// @vitest-environment jsdom
//
// Client report (Manish / Admizz, Nov 2026): a lead from the Nepal-UK form held "uk" and "nepal"; the Study Interest
// picker showed the text "uk, nepal" but NO box ticked, and UK could not be ticked ("Uk select garna diyena").

import { describe, it, expect, vi, afterEach } from "vitest";
import { render, screen, fireEvent, cleanup } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { useState } from "react";

import { DestinationsMultiSelect } from "./destinations-multi-select";

afterEach(cleanup);

const OPTIONS = ["Australia", "Canada", "Nepal", "UK", "USA"];

function open() {
  fireEvent.click(screen.getByRole("button"));
}
const box = (name: string) => screen.getByRole("checkbox", { name });

describe("DestinationsMultiSelect — catalog matching ignores case", () => {
  it("a lead saved with lowercase values shows the catalog entries TICKED", () => {
    render(<DestinationsMultiSelect selected={["uk", "nepal"]} onChange={vi.fn()} options={OPTIONS} />);
    open();
    expect(box("UK")).toBeChecked();
    expect(box("Nepal")).toBeChecked();
    expect(box("Australia")).not.toBeChecked();
  });

  it("the button text shows the catalog spelling, not the lowercase leftovers", () => {
    render(<DestinationsMultiSelect selected={["uk", "nepal"]} onChange={vi.fn()} options={OPTIONS} />);
    expect(screen.getByRole("button")).toHaveTextContent("UK, Nepal");
  });

  it("UNticking UK works (the reported 'cannot change' case) and reports the catalog spelling of what remains", () => {
    const onChange = vi.fn();
    render(<DestinationsMultiSelect selected={["uk", "nepal"]} onChange={onChange} options={OPTIONS} />);
    open();
    fireEvent.click(box("UK"));
    expect(onChange).toHaveBeenLastCalledWith(["Nepal"]);
  });

  it("ticking a new country adds it in the catalog spelling and heals the old lowercase values", () => {
    const onChange = vi.fn();
    render(<DestinationsMultiSelect selected={["uk"]} onChange={onChange} options={OPTIONS} />);
    open();
    fireEvent.click(box("USA"));
    expect(onChange).toHaveBeenLastCalledWith(["UK", "USA"]);
  });

  it("flag decoration and stray spaces still match", () => {
    render(<DestinationsMultiSelect selected={["🇬🇧 UK", " usa "]} onChange={vi.fn()} options={OPTIONS} />);
    open();
    expect(box("UK")).toBeChecked();
    expect(box("USA")).toBeChecked();
  });

  it("works end-to-end as a controlled field: untick the lowercase value, then tick it again", () => {
    function Harness() {
      const [sel, setSel] = useState<string[]>(["uk", "nepal"]);
      return <DestinationsMultiSelect selected={sel} onChange={setSel} options={OPTIONS} />;
    }
    render(<Harness />);
    open();
    fireEvent.click(box("UK"));
    expect(box("UK")).not.toBeChecked();
    fireEvent.click(box("UK"));
    expect(box("UK")).toBeChecked();
    expect(box("Nepal")).toBeChecked();
  });

  it("a selected value the catalog doesn't have gets its own checkbox, so it can be unticked", () => {
    const onChange = vi.fn();
    render(<DestinationsMultiSelect selected={["Narnia", "uk"]} onChange={onChange} options={OPTIONS} />);
    open();
    expect(box("Narnia")).toBeChecked();
    fireEvent.click(box("Narnia"));
    expect(onChange).toHaveBeenLastCalledWith(["UK"]);
  });

  it("with no catalog loaded yet, the selected values are still shown and untickable (nothing is lost)", () => {
    const onChange = vi.fn();
    render(<DestinationsMultiSelect selected={["uk"]} onChange={onChange} options={[]} />);
    open();
    fireEvent.click(box("uk"));
    expect(onChange).toHaveBeenLastCalledWith([]);
  });

  it("an already-correct selection behaves exactly as before", () => {
    const onChange = vi.fn();
    render(<DestinationsMultiSelect selected={["UK"]} onChange={onChange} options={OPTIONS} />);
    open();
    expect(box("UK")).toBeChecked();
    fireEvent.click(box("Canada"));
    expect(onChange).toHaveBeenLastCalledWith(["UK", "Canada"]);
  });
});
