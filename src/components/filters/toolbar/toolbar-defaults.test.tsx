import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { SearchField } from "./search-field";
import { parseColumnWidth, COLUMN_WIDTH_PX } from "@/industries/education-consultancy/features/application-tracking/lib/board-view-prefs";

describe("promoted toolbar parts keep the Leads strings by default", () => {
  it("SearchField", () => {
    const html = renderToStaticMarkup(<SearchField value="" onChange={() => {}} />);
    expect(html).toContain('placeholder="Search leads"');
    expect(html).toContain('aria-label="Search leads"');
    expect(html).toContain('data-testid="leads-search"');
  });
  it("SearchField takes Applications strings when passed", () => {
    const html = renderToStaticMarkup(<SearchField value="" onChange={() => {}} placeholder="Search applications" ariaLabel="Search applications" testId="applications-search" />);
    expect(html).toContain('data-testid="applications-search"');
  });
});

describe("column width pref", () => {
  it("defaults to wide on garbage; narrow 232 / wide 268", () => {
    expect(parseColumnWidth("huge")).toBe("wide");
    expect(parseColumnWidth("narrow")).toBe("narrow");
    expect(COLUMN_WIDTH_PX).toEqual({ narrow: 232, wide: 268 });
  });
});

// Fix round 2 (A1): the Applications pill chip + dashed "+" are opt-in variants; Leads keeps the defaults.
import { FilterChips } from "./filter-chips";
import { FilterMenu } from "./filter-menu";
import type { FieldDef, FilterTree } from "@/lib/filters/types";

const FIELD = { key: "offer_type", label: "Offer type", type: "select", filterable: true, options: [{ value: "conditional", label: "Conditional" }] } as unknown as FieldDef;
const TREE: FilterTree = { conjunction: "and", conditions: [{ id: "c1", field: "offer_type", op: "is_any_of", value: ["conditional"] }] };
const CTX = { getOptions: (f: FieldDef) => (f.options ?? []).map((o) => ({ value: o.value, label: o.label })), countSources: {} };

describe("FilterChips variants", () => {
  it("default (Leads) is the segmented chip with dividers", () => {
    const html = renderToStaticMarkup(<FilterChips fields={[FIELD]} tree={TREE} onChange={() => {}} ctx={CTX} maxConditions={12} />);
    expect(html).toContain("border-l border-ds-divider");
    expect(html).not.toContain('data-variant="pill"');
  });
  it("pill (Applications) is one bordered pill: no dividers, each part still a button", () => {
    const html = renderToStaticMarkup(<FilterChips fields={[FIELD]} tree={TREE} onChange={() => {}} ctx={CTX} maxConditions={12} variant="pill" />);
    expect(html).toContain('data-variant="pill"');
    expect(html).not.toContain("border-l");
    expect(html).toContain("h-7");
    expect(html).toContain("rounded-[8px] border border-ds-border bg-ds-sunken px-2.5 text-[13px]");
    for (const label of ["Edit Offer type filter", "Change Offer type operator", "Edit Offer type value", "Remove Offer type filter"]) {
      expect(html).toContain(`aria-label="${label}"`);
    }
    expect(html).toContain("Conditional");
  });
});

describe("FilterMenu add button variants", () => {
  const menu = (variant: "chip" | "plus" | "dashed-plus") =>
    renderToStaticMarkup(
      <FilterMenu fields={[FIELD]} tree={TREE} onChange={() => {}} ctx={CTX} mostUsedKeys={[]} variant={variant} maxConditions={12} open={false} onOpenChange={() => {}} />,
    );
  it("Leads' plus is unchanged (no dashed border)", () => {
    expect(menu("plus")).not.toContain("border-dashed");
    expect(menu("plus")).toContain('data-testid="leads-filter-trigger"');
  });
  it("dashed-plus is the 28px dashed ghost button", () => {
    const html = menu("dashed-plus");
    expect(html).toContain("h-7");
    expect(html).toContain("border border-dashed border-ds-ghost");
    expect(html).toContain('aria-label="Add filter"');
  });
});

// EDGEX-141 Phase 5: the bottom-sheet container is opt-in. With no `container` prop (Leads never
// passes one) the parts render the popover markup: no sheet, the trigger keeps its Radix popover
// attributes, and the output equals an explicit container="popover".
describe("container prop: Leads guard", () => {
  const menuHtml = (container?: "popover" | "sheet") =>
    renderToStaticMarkup(
      <FilterMenu fields={[FIELD]} tree={TREE} onChange={() => {}} ctx={CTX} mostUsedKeys={[]} variant="chip" maxConditions={12} open={false} onOpenChange={() => {}} container={container} />,
    );
  const chipsHtml = (container?: "popover" | "sheet") =>
    renderToStaticMarkup(<FilterChips fields={[FIELD]} tree={TREE} onChange={() => {}} ctx={CTX} maxConditions={12} container={container} />);

  it("FilterMenu with no container renders the popover trigger, identical to container='popover'", () => {
    expect(menuHtml()).toBe(menuHtml("popover"));
    expect(menuHtml()).toContain('aria-haspopup="dialog"');
    expect(menuHtml()).toContain('data-testid="leads-filter-trigger"');
  });
  it("FilterChips with no container is identical to container='popover'", () => {
    expect(chipsHtml()).toBe(chipsHtml("popover"));
    expect(chipsHtml()).toContain("border-l border-ds-divider");
  });
  it("only container='sheet' drops the popover trigger attributes (Applications phone)", () => {
    expect(menuHtml("sheet")).not.toContain("aria-haspopup");
    expect(menuHtml("sheet")).toContain('data-testid="leads-filter-trigger"');
  });
});
