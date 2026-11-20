import { describe, it, expect } from "vitest";
import { SORT_FIELD_TO_API, COLUMN_SORT_FIELD, DESC_FIRST_SORT_FIELDS, HEADER_SORT_LABELS } from "./sort-fields";
import { leadFields } from "@/lib/filters/registry/leads";
import { planFilter } from "@/lib/filters/compile";
import { getLeadColumns } from "@/components/dashboard/leads/columns-registry";
import type { CompileCtx, FilterTree } from "@/lib/filters/types";

// Client request (Manish / Admizz, Nov 2026): click-to-sort on every Leads column. These are the CONTRACT checks that
// keep the three places that must agree in step — the header map, the API sort keys, and the server allow-list —
// so a typo is a failing test, not a 422/503 only a user would ever see.

const ctx = { tz: "UTC", now: new Date(0), industryId: "education_consultancy", permissions: {} } as unknown as CompileCtx;
const registry = leadFields(ctx);

describe("Leads header sort — contract", () => {
  it("every API sort key the UI can send is allow-listed by the server registry, with real sort columns", () => {
    for (const [uiField, apiKey] of Object.entries(SORT_FIELD_TO_API)) {
      const def = registry[apiKey];
      expect(def, `${uiField} -> "${apiKey}" is not a registry field`).toBeDefined();
      expect(def.sortable, `${apiKey} must be sortable`).toBe(true);
      expect(def.sortColumns?.length, `${apiKey} needs sortColumns`).toBeGreaterThan(0);
    }
  });

  it("every column-header sort points at a known sort field", () => {
    for (const [col, field] of Object.entries(COLUMN_SORT_FIELD)) {
      expect(SORT_FIELD_TO_API[field], `column "${col}" -> unknown sort field "${field}"`).toBeDefined();
    }
  });

  it("every column that gets a sort icon is a real column in the table", () => {
    const real = new Set<string>();
    for (const industry of ["education_consultancy", "it_agency", "travel_agency", null]) {
      for (const c of getLeadColumns(industry, [], 2)) real.add(c.key);
    }
    for (const col of Object.keys(COLUMN_SORT_FIELD)) {
      expect(real.has(col), `COLUMN_SORT_FIELD has "${col}" but no such column exists`).toBe(true);
    }
  });

  it("every extra Sort-popover entry and desc-first field is a known sort field", () => {
    for (const [field] of HEADER_SORT_LABELS) expect(SORT_FIELD_TO_API[field]).toBeDefined();
    for (const field of DESC_FIRST_SORT_FIELDS) expect(SORT_FIELD_TO_API[field]).toBeDefined();
  });

  it("columns that need a lookup to sort correctly get NO sort icon", () => {
    for (const col of ["assigned", "status", "lead_type", "branch", "tags", "owner", "destinations", "display_id", "ai_priority", "assigned_role"]) {
      expect(COLUMN_SORT_FIELD[col], `${col} must not be header-sortable yet`).toBeUndefined();
    }
  });

  it("columns whose blanks must sort last use sortNullsFirst:false", () => {
    for (const key of ["phone", "location", "source", "ref_code", "form_source", "intake_medium", "intake_campaign", "preferred_contact_method", "ai_score", "company_name", "designation", "salutation", "company_email", "archived_at", "industry"]) {
      expect(registry[key].sortNullsFirst, key).toBe(false);
    }
  });

  it("sort-only fields are NOT filterable and stay out of the filter picker's reach", () => {
    for (const key of ["ref_code", "form_source", "intake_medium", "intake_campaign", "preferred_contact_method", "ai_score", "company_name", "designation", "salutation", "company_email", "archived_at"]) {
      expect(registry[key].filterable, key).toBe(false);
      const tree = { conjunction: "and", conditions: [{ id: "c", field: key, op: "is_empty" }], groups: [] } as unknown as FilterTree;
      expect(planFilter(tree, registry, ctx).ok, `${key} must not be usable as a filter`).toBe(false);
    }
  });

  it("location sorts by country then city", () => {
    expect(registry.location.sortColumns).toEqual(["country", "city"]);
  });
});
