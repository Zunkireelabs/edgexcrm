import { describe, it, expect } from "vitest";
import type { ReactNode, ReactElement } from "react";
import { getLeadColumns } from "./columns-registry";
import type { Lead } from "@/types/database";

// Client-reported (2026-09-07): the Destinations filter showed "UK" and
// "🇬🇧 UK" as separate options. Traced to three display paths — the main
// "Destination" table column and the lead detail sidebar already normalized
// (destination-normalize.ts), but this custom-field fallback column (shown
// when a tenant has a custom field literally named "countries" or
// "field_of_study") did not, and rendered the raw, undecorated value.

function fakeLead(overrides: Partial<Lead> = {}): Lead {
  return {
    id: "lead-1",
    tenant_id: "tenant-1",
    destinations: [],
    field_of_study: null,
    custom_fields: {},
    ...overrides,
  } as unknown as Lead;
}

// renderTd always returns a <td>...</td> element in practice (this file's
// implementation never returns null/a string/etc directly) — narrowed here
// rather than typed that way in columns-registry.tsx itself, since the
// LeadColumn interface's renderTd: (..) => React.ReactNode signature is
// shared by every column, most of which legitimately return other node
// shapes.
function cellText(node: ReactNode): string {
  const el = node as ReactElement;
  const children = (el.props as { children: unknown }).children;
  return Array.isArray(children) ? children.filter((c) => typeof c === "string" || typeof c === "number").join("") : String(children ?? "");
}

describe("getLeadColumns — 'countries' custom-field fallback column normalization", () => {
  it("strips flag-emoji decoration from destinations before rendering", () => {
    const cols = getLeadColumns("education_consultancy", ["countries"]);
    const col = cols.find((c) => c.key === "cf:countries");
    expect(col).toBeDefined();
    const lead = fakeLead({ destinations: ["🇬🇧 UK", "🇮🇳 India"] });
    const rendered = col!.renderTd(lead, {} as never);
    expect(cellText(rendered)).toBe("UK, India");
  });

  it("still shows a value for leads with no decoration — not a regression to blank", () => {
    const cols = getLeadColumns("education_consultancy", ["countries"]);
    const col = cols.find((c) => c.key === "cf:countries")!;
    const lead = fakeLead({ destinations: ["Canada", "Australia"] });
    expect(cellText(col.renderTd(lead, {} as never))).toBe("Canada, Australia");
  });
});

describe("getLeadColumns — 'field_of_study' custom-field fallback column normalization", () => {
  it("strips decoration from field_of_study before rendering", () => {
    const cols = getLeadColumns("education_consultancy", ["field_of_study"]);
    const col = cols.find((c) => c.key === "cf:field_of_study")!;
    const lead = fakeLead({ field_of_study: "🎓 Computer Science" });
    expect(cellText(col.renderTd(lead, {} as never))).toBe("Computer Science");
  });
});
