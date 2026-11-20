// @vitest-environment jsdom

// EDGEX-141 Phase 5 fix round 1: a phone sheet must not pop the keyboard (no auto-focused search,
// no pre-highlighted row); the popover path (Leads, desktop) keeps autoFocus + highlight-at-0.
import { describe, it, expect, afterEach } from "vitest";
import { render, screen, cleanup, within } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import { BottomSheet } from "@/components/ui/bottom-sheet";
import { FieldMenuPanel, ValuesPanel } from "./panels";
import { FilterChips } from "./filter-chips";
import { shortPersonName } from "./chip-parts";
import type { FieldDef, FilterTree } from "@/lib/filters/types";

afterEach(() => cleanup());

const F = (key: string, label: string) => ({ key, label, type: "select", filterable: true }) as unknown as FieldDef;
const FIELDS = [F("stage", "Stage"), F("counsellor", "Counsellor")];

function fieldPanel() {
  return <FieldMenuPanel fields={FIELDS} mostUsedKeys={["stage"]} optionCount={() => 3} onSelect={() => {}} />;
}

describe("sheet search focus", () => {
  it("Filter sheet: activeElement is not an input and no row is highlighted", () => {
    render(
      <BottomSheet open onOpenChange={() => {}} title="Filter" testId="s">
        {fieldPanel()}
      </BottomSheet>,
    );
    expect(document.activeElement?.tagName).not.toBe("INPUT");
    const sheet = screen.getByTestId("s");
    expect(sheet.querySelector('[data-active="true"]')).toBeNull();
    // tapping the input still focuses it
    const input = within(sheet).getByPlaceholderText("Filter by…");
    input.focus();
    expect(document.activeElement).toBe(input);
  });

  it("value-edit sheet (ValuesPanel): no auto-focus, no highlight", () => {
    render(
      <BottomSheet open onOpenChange={() => {}} title="Counsellor" testId="s">
        <ValuesPanel
          field={F("counsellor", "Counsellor")}
          rows={[
            { value: "a", label: "Asha Thapa", count: 1 },
            { value: "b", label: "Gita Karki", count: 2 },
          ] as never}
          selected={[]}
          onToggle={() => {}}
        />
      </BottomSheet>,
    );
    expect(document.activeElement?.tagName).not.toBe("INPUT");
    expect(screen.getByTestId("s").querySelector('[data-active="true"]')).toBeNull();
  });

  it("popover path (Leads / desktop) keeps autoFocus and highlight-at-0", () => {
    const { container } = render(fieldPanel());
    expect(document.activeElement).toBe(screen.getByPlaceholderText("Filter by…"));
    expect(container.querySelector('[data-active="true"]')).not.toBeNull();
  });
});

describe("phone chip value", () => {
  const COUNSELLOR = { ...F("counsellor", "Counsellor"), options: [{ value: "g", label: "Gita Karki" }, { value: "a", label: "Asha Thapa" }] } as unknown as FieldDef;
  const ctx = { getOptions: (f: FieldDef) => (f.options ?? []).map((o) => ({ value: o.value, label: o.label })), countSources: {} };
  const tree = (value: string[]): FilterTree => ({ conjunction: "and", conditions: [{ id: "c1", field: "counsellor", op: "is_any_of", value }] });
  const html = (container: "popover" | "sheet", value: string[]) => {
    const { container: c } = render(<FilterChips fields={[COUNSELLOR]} tree={tree(value)} onChange={() => {}} ctx={ctx} maxConditions={12} variant="pill" container={container} />);
    const text = c.textContent ?? "";
    cleanup();
    return text;
  };
  it("sheet: one person shortens to first name + last initial", () => {
    expect(html("sheet", ["g"])).toContain("Gita K.");
    expect(html("sheet", ["g"])).not.toContain("Gita Karki");
  });
  it("popover keeps the full name", () => {
    expect(html("popover", ["g"])).toContain("Gita Karki");
  });
  it("several values keep the existing summary in both containers", () => {
    expect(html("sheet", ["g", "a"])).toBe(html("popover", ["g", "a"]));
  });
  it("shortPersonName", () => {
    expect(shortPersonName("Gita Karki")).toBe("Gita K.");
    expect(shortPersonName("Asha")).toBe("Asha");
    expect(shortPersonName("Ram Bahadur Thapa")).toBe("Ram T.");
  });
});
