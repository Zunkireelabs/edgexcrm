import { describe, it, expect } from "vitest";
import { formatChipLabel, resolveChipColor, DEFAULT_CHIP_COLOR } from "./chip-label";
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
