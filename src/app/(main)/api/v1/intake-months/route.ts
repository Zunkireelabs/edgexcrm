import { createLookupTableListRoutes } from "@/lib/api/lookup-table-routes";

export const { GET, POST } = createLookupTableListRoutes({
  table: "intake_months",
  itemLabel: "intake month",
  routePath: "/api/v1/intake-months",
  sortColumn: "sort_order",
});
