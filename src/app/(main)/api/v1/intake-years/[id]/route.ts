import { createLookupTableItemRoutes } from "@/lib/api/lookup-table-routes";

export const { PATCH, DELETE } = createLookupTableItemRoutes({
  table: "intake_years",
  itemLabel: "intake year",
  routePath: "/api/v1/intake-years",
});
