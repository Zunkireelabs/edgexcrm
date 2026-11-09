import { describe, expect, it } from "vitest";
import { stageDotColor } from "./stage-color";
import { getLeadColumns } from "../columns-registry";
import { rowSignal, twoLetterInitials, v2For, V2_DEFAULT_KEYS } from "./v2-columns";
import { CHECKBOX_WIDTH } from "./grid-layout";
import { NAME_DEFAULT_WIDTH } from "./leads-grid";

describe("stageDotColor", () => {
  it("non-null colour wins", () => expect(stageDotColor({ slug: "qualified", color: "#123456" })).toBe("#123456"));
  it("falls back by slug when colour is null", () => {
    expect(stageDotColor({ slug: "pre-qualified", color: null })).toBe("var(--ds-faint)");
    expect(stageDotColor({ slug: "qualified", color: null })).toBe("var(--ds-accent)");
    expect(stageDotColor({ slug: "prospects", color: null })).toBe("var(--ds-warn)");
    expect(stageDotColor({ slug: "applications", color: null })).toBe("var(--ds-good)");
    expect(stageDotColor({ slug: "other", color: null })).toBe("var(--ds-ghost)");
    expect(stageDotColor(undefined)).toBe("var(--ds-ghost)");
  });
});

describe("twoLetterInitials", () => {
  it("uses first and last name, or two letters of a single name", () => {
    expect(twoLetterInitials("Kamana Rai")).toBe("KR");
    expect(twoLetterInitials("kamana")).toBe("KA");
    expect(twoLetterInitials("")).toBe("?");
  });
});

describe("default column widths match the mockup", () => {
  it("per-column widths", () => {
    expect(NAME_DEFAULT_WIDTH).toBe(210);
    const w = Object.fromEntries(V2_DEFAULT_KEYS.map((k) => [k, v2For(k).width]));
    expect(w).toEqual({ lead_type: 150, assigned: 160, email: 240, location: 140, display_id: 124, last_activity: 180 });
  });
  it("defaults fit in a 1280px content width", () => {
    const total = CHECKBOX_WIDTH + NAME_DEFAULT_WIDTH + V2_DEFAULT_KEYS.reduce((n, k) => n + (v2For(k).width ?? 0), 0);
    expect(total).toBeLessThanOrEqual(1280);
  });
});

describe("archived view polish", () => {
  const lead = { callback_at: "2000-01-01T00:00:00Z", last_activity_at: "2000-01-01T00:00:00Z", created_at: "2000-01-01T00:00:00Z" } as never;
  it("v2 labels and widths for the archive columns", () => {
    expect(v2For("archived_from_stage")).toMatchObject({ label: "Archived from", width: 180 });
    expect(v2For("archived_from_status")).toMatchObject({ width: 120 });
    expect(v2For("archived_by")).toMatchObject({ width: 160 });
    expect(v2For("archived_at")).toMatchObject({ width: 180 });
    for (const k of ["archived_from_stage", "archived_from_status", "archived_by", "archived_at"]) expect(v2For(k).icon).toBeDefined();
  });
  it("no follow-up flag on archived or deleted leads", () => {
    const ctx = { industryId: "education_consultancy", followUpStaleDays: 7 };
    expect(rowSignal(lead, { ...ctx, viewMode: "archived" })).toBeNull();
    expect(rowSignal(lead, { ...ctx, viewMode: "trash" })).toBeNull();
    expect(rowSignal(lead, { ...ctx, viewMode: "normal" })).not.toBeNull();
  });
});

describe("header labels fit their column width", () => {
  // ~8px per character at 14px Inter, plus ~70px for padding, icon, gap and the hidden sort/pin glyph.
  it("width >= label length * 8 + 70 for every v2 column", () => {
    const labels = Object.fromEntries(getLeadColumns("education_consultancy", [], 2).map((c) => [c.key, c.label]));
    const keys = [...V2_DEFAULT_KEYS, "name", "phone", "created", "updated_at", "tags", "status", "source", "destinations", "ref_code", "form_source", "branch", "archived_from_stage", "archived_from_status", "archived_by", "archived_at"];
    const bad: string[] = [];
    for (const k of keys) {
      const v = v2For(k);
      const label = v.label ?? labels[k];
      if (label && v.width < label.length * 8 + 70) bad.push(`${k} "${label}" needs ${label.length * 8 + 70}, has ${v.width}`);
    }
    expect(bad).toEqual([]);
  });
  it("common fields have real icons", () => {
    for (const k of ["tags", "status", "source", "destinations", "ref_code", "form_source", "branch", "created", "updated_at"]) expect(v2For(k).icon).toBeDefined();
  });
});
