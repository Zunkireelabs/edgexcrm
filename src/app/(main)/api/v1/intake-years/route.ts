import { createLookupTableListRoutes } from "@/lib/api/lookup-table-routes";

export const { GET, POST } = createLookupTableListRoutes({
  table: "intake_years",
  itemLabel: "intake year",
  routePath: "/api/v1/intake-years",
});
