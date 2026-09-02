import { describe, it, expect } from "vitest";
import { formatChipLabel, resolveChipColor, DEFAULT_CHIP_COLOR, scopeOptionsToConditionGroup } from "./chip-label";
import type { FieldDef, FilterCondition } from "@/lib/filters/types";
import type { FilterOption } from "@/components/ui/filter-dropdown";

const field: FieldDef = {
  key: "status",
  label: "Status",
  type: "select",
  source: { kind: "column", column: "status" },
  group: "Basic",
  filterable: true,
};

const stageOptions: FilterOption[] = [
  { value: "enrolled", label: "Enrolled", color: "#16a34a" },
  { value: "rejected", label: "Rejected", color: "#dc2626" },
];

describe("resolveChipColor — every chip colored (production behavior, not the reverted fabricated scheme)", () => {
  it("a single value with real per-value color data uses that real color, not the default", () => {
    const cond: FilterCondition = { id: "c1", field: "status", op: "is", value: "enrolled" };
    expect(resolveChipColor(cond, stageOptions)).toBe("#16a34a");
  });

  it("a single value with NO real per-value color data falls back to DEFAULT_CHIP_COLOR", () => {
    const cond: FilterCondition = { id: "c1", field: "assignees", op: "is_any_of", value: ["u1"] };
    const options: FilterOption[] = [{ value: "u1", label: "Sadin (12)" }]; // no `color`
    expect(resolveChipColor(cond, options)).toBe(DEFAULT_CHIP_COLOR);
  });

  it("a field with no options at all (e.g. free text) falls back to DEFAULT_CHIP_COLOR, never undefined", () => {
    const cond: FilterCondition = { id: "c1", field: "first_name", op: "contains", value: "john" };
    expect(resolveChipColor(cond, [])).toBe(DEFAULT_CHIP_COLOR);
  });

  it("a multi-value selection falls back to DEFAULT_CHIP_COLOR — no ambiguous per-value pick, but still colored (not the old plain-neutral behavior)", () => {
    const cond: FilterCondition = { id: "c1", field: "status", op: "is_any_of", value: ["enrolled", "rejected"] };
    expect(resolveChipColor(cond, stageOptions)).toBe(DEFAULT_CHIP_COLOR);
  });

  it("always returns a string — never undefined — for any condition shape", () => {
    const noValueCond: FilterCondition = { id: "c1", field: "email", op: "is_empty" };
    expect(typeof resolveChipColor(noValueCond, [])).toBe("string");
  });
});

describe("formatChipLabel — unaffected by the color change (label formatting is independent)", () => {
  it("still formats a simple 'is' condition without an operator prefix", () => {
    const cond: FilterCondition = { id: "c1", field: "status", op: "is", value: "enrolled" };
    expect(formatChipLabel(field, cond, stageOptions)).toBe("Status: Enrolled");
  });
});

describe("scopeOptionsToConditionGroup — reopened chips only offer their own category's options", () => {
  // Mirrors the email-campaigns composer's widened `stage` override: every lead
  // list, each tagged with which of the 4 picker categories it belongs to.
  const groupedOptions: FilterOption[] = [
    { value: "s1", label: "Pre-qualified", groupLabel: "Stage" },
    { value: "s2", label: "Qualified", groupLabel: "Stage" },
    { value: "o1", label: "New Leads", groupLabel: "Leads Organize" },
    { value: "o2", label: "Migration QC", groupLabel: "Leads Organize" },
    { value: "a1", label: "Archived", groupLabel: "Archive" },
    { value: "d1", label: "Trash", groupLabel: "Delete" },
  ];

  it("narrows to only the Leads Organize options when reopening a Leads Organize chip", () => {
    const cond: FilterCondition = { id: "c1", field: "stage", op: "is", value: "o1" };
    expect(scopeOptionsToConditionGroup(cond, groupedOptions).map((o) => o.value)).toEqual(["o1", "o2"]);
  });

  it("narrows to only the pipeline Stage options when reopening a Stage chip", () => {
    const cond: FilterCondition = { id: "c1", field: "stage", op: "is", value: "s2" };
    expect(scopeOptionsToConditionGroup(cond, groupedOptions).map((o) => o.value)).toEqual(["s1", "s2"]);
  });

  it("narrows a single-item Archive / Delete category to just that option", () => {
    const cond: FilterCondition = { id: "c1", field: "stage", op: "is", value: "a1" };
    expect(scopeOptionsToConditionGroup(cond, groupedOptions).map((o) => o.value)).toEqual(["a1"]);
  });

  it("returns the full list unchanged for fields whose options carry no groupLabel", () => {
    const cond: FilterCondition = { id: "c1", field: "status", op: "is", value: "enrolled" };
    expect(scopeOptionsToConditionGroup(cond, stageOptions)).toBe(stageOptions);
  });

  it("returns the full list for a no-value operator (nothing to scope by)", () => {
    const cond: FilterCondition = { id: "c1", field: "stage", op: "is_empty" };
    expect(scopeOptionsToConditionGroup(cond, groupedOptions)).toBe(groupedOptions);
  });

  it("returns the full list when a stale value no longer resolves to any option", () => {
    const cond: FilterCondition = { id: "c1", field: "stage", op: "is", value: "gone" };
    expect(scopeOptionsToConditionGroup(cond, groupedOptions)).toBe(groupedOptions);
  });

  it("keeps a multi-select scoped when every picked value shares one category", () => {
    const cond: FilterCondition = { id: "c1", field: "stage", op: "is_any_of", value: ["o1", "o2"] };
    expect(scopeOptionsToConditionGroup(cond, groupedOptions).map((o) => o.value)).toEqual(["o1", "o2"]);
  });

  it("returns the full list for a multi-select that spans categories (no single group to narrow to)", () => {
    const cond: FilterCondition = { id: "c1", field: "stage", op: "is_any_of", value: ["s1", "o1"] };
    expect(scopeOptionsToConditionGroup(cond, groupedOptions)).toBe(groupedOptions);
  });
});
