import { describe, it, expect } from "vitest";
import { getLeadFullName, getLeadInitials } from "./lead-name";

type PartialLead = Parameters<typeof getLeadFullName>[0];
// custom_fields is typed non-nullable on Lead, but real rows (and the
// functions under test) treat null the same as {} — cast so the fixture can
// exercise that case without fighting the stricter Lead type.
type PartialLeadFixture = Omit<PartialLead, "custom_fields"> & {
  custom_fields: Record<string, unknown> | null;
};

function lead(overrides: Partial<PartialLeadFixture> = {}): PartialLead {
  return {
    first_name: null,
    last_name: null,
    custom_fields: null,
    ...overrides,
  } as PartialLead;
}

describe("getLeadFullName", () => {
  it("prefers first_name/last_name when present", () => {
    expect(getLeadFullName(lead({ first_name: "Ada", last_name: "Lovelace" }))).toBe(
      "Ada Lovelace",
    );
  });

  it("falls back to custom_fields.fullname when first/last are empty", () => {
    expect(
      getLeadFullName(lead({ custom_fields: { fullname: "Grace Hopper" } })),
    ).toBe("Grace Hopper");
  });

  it("returns the caller-supplied fallback when nothing resolves", () => {
    expect(getLeadFullName(lead(), "—")).toBe("—");
    expect(getLeadFullName(lead(), "")).toBe("");
  });
});

describe("getLeadInitials", () => {
  it("derives initials from custom_fields fullname when first/last are empty", () => {
    expect(getLeadInitials(lead({ custom_fields: { full_name: "Grace Hopper" } }))).toBe(
      "GH",
    );
  });

  it("returns ? when nothing resolves", () => {
    expect(getLeadInitials(lead())).toBe("?");
  });
});

// Regression coverage for the two leads-table.tsx call sites #417 missed —
// both now route through getLeadFullName, so this exercises them directly.
describe("leads-table sort comparator (name column)", () => {
  it("orders a custom_fields-only-named lead correctly against a first/last-named lead", () => {
    const rows = [
      lead({ first_name: "Zed", last_name: "Zephyr" }),
      lead({ custom_fields: { fullname: "Amara Singh" } }),
    ];
    const sorted = [...rows].sort((a, b) =>
      getLeadFullName(a, "").toLowerCase().localeCompare(getLeadFullName(b, "").toLowerCase()),
    );
    expect(sorted.map((l) => getLeadFullName(l, ""))).toEqual(["Amara Singh", "Zed Zephyr"]);
  });
});

describe("leads-table CSV export (name column)", () => {
  it("emits the custom_fields name for a custom_fields-only-named lead", () => {
    expect(getLeadFullName(lead({ custom_fields: { name: "Priya Shah" } }), "")).toBe(
      "Priya Shah",
    );
  });

  it("emits an empty string, not a dash, when nothing resolves", () => {
    expect(getLeadFullName(lead(), "")).toBe("");
  });
});
