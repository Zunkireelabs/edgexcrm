import { createLookupTableItemRoutes } from "@/lib/api/lookup-table-routes";

export const { PATCH, DELETE } = createLookupTableItemRoutes({
  table: "intake_months",
  itemLabel: "intake month",
  routePath: "/api/v1/intake-months",
});
