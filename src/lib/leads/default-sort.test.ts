import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { LEADS_V2_DEFAULT_SORT, resolveLeadsSort } from "./default-sort";
import { leadFields } from "@/lib/filters/registry/leads";
import type { CompileCtx } from "@/lib/filters/types";

const registry = leadFields({} as CompileCtx);

describe("v2 leads default sort (EDGEX-122)", () => {
  it("is Last activity, newest first, and resolvable through the registry the API uses", () => {
    expect(LEADS_V2_DEFAULT_SORT).toEqual({ key: "last_activity_at", direction: "desc" });
    const r = resolveLeadsSort(registry, LEADS_V2_DEFAULT_SORT.key, LEADS_V2_DEFAULT_SORT.direction);
    expect(r).toEqual({ columns: ["last_activity_at"], ascending: false, nullsFirst: undefined });
  });

  it("returns null for non-sortable keys", () => {
    expect(resolveLeadsSort(registry, "status", "desc")).toBeNull();
  });

  it("client initial state is derived from the same constant, and the SORT_FIELD_TO_API map contains its key", () => {
    const src = readFileSync("src/components/dashboard/leads-table.tsx", "utf8");
    expect(src).toContain("LEADS_V2_DEFAULT_SORT.key");
    expect(src).toContain("useState<SortDirection>(LEADS_V2_DEFAULT_SORT.direction)");
    // SORT_FIELD_TO_API moved out of the component into lib/leads/sort-fields.ts (stage #681 click-to-sort).
    expect(src).toContain("SORT_FIELD_TO_API");
    const map = readFileSync("src/lib/leads/sort-fields.ts", "utf8");
    expect(map).toContain(`: "${LEADS_V2_DEFAULT_SORT.key}"`);
  });

  it("server first page is wired to the constant", () => {
    const q = readFileSync("src/lib/supabase/queries.ts", "utf8");
    expect(q).toContain("LEADS_V2_DEFAULT_SORT.key");
    expect(q).toContain("LEADS_V2_DEFAULT_SORT.direction");
  });
});
