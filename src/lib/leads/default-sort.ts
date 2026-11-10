import type { FieldRegistry } from "@/lib/filters/types";

/**
 * EDGEX-122 — the ONE default sort of the v2 leads table (education_consultancy +
 * advanced filters). The client's initial sort state and the server-rendered first
 * page (getLeadsPage) both read this, so first paint and the hydrated refetch can
 * never disagree. `key` is a GET /api/v1/leads `sort` value (a filter-registry key).
 */
export const LEADS_V2_DEFAULT_SORT = { key: "last_activity_at", direction: "desc" } as const;

export interface ResolvedLeadsSort {
  columns: string[];
  ascending: boolean;
  nullsFirst: boolean | undefined;
}

/** Registry key + direction -> the exact .order() inputs. Shared by the API route and
 *  the SSR first page so both map through the same `sortColumns` / `sortNullsFirst`. */
export function resolveLeadsSort(
  registry: FieldRegistry,
  key: string,
  direction: "asc" | "desc",
): ResolvedLeadsSort | null {
  const field = registry[key];
  if (!field?.sortable || !field.sortColumns) return null;
  return { columns: [...field.sortColumns], ascending: direction === "asc", nullsFirst: field.sortNullsFirst };
}
