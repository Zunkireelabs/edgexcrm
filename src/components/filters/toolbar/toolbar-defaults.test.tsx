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
