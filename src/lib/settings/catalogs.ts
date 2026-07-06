/**
 * Catalog helpers shared between settings/page.tsx and the bootstrap API route.
 * Extracted so PositionsManager nav-permission checkboxes always use the same
 * key set — if this diverged, RBAC permissions would silently break.
 */

import { getIndustrySidebarItems } from "@/industries/_loader";

export interface NavCatalogItem {
  key: string;
  label: string;
}

export interface WidgetCatalogItem {
  key: string;
  label: string;
}

const UNIVERSAL_NAV: NavCatalogItem[] = [
  { key: "/dashboard", label: "Dashboard" },
  { key: "/leads", label: "All Leads" },
  { key: "/pipeline", label: "Pipeline" },
  { key: "/knowledge-bases", label: "Knowledge Bases" },
  { key: "/team", label: "Team" },
  { key: "/leave", label: "Leave" },
  { key: "/settings", label: "Settings" },
];

export const WIDGET_CATALOG: WidgetCatalogItem[] = [
  { key: "stats", label: "Stats cards" },
  { key: "leads-by-stage", label: "Leads by stage" },
  { key: "leads-by-source", label: "Leads by source" },
  { key: "leads-by-counselor", label: "Leads by counselor" },
  { key: "utm", label: "UTM attribution" },
];

export function buildNavCatalog(industryId: string | null | undefined): NavCatalogItem[] {
  const industryNav = getIndustrySidebarItems(industryId, "owner").flatMap((entry) => {
    if ("children" in entry) {
      return entry.children.map((child) => ({ key: child.href, label: child.label }));
    }
    return [{ key: entry.href, label: entry.label }];
  });
  return [...UNIVERSAL_NAV, ...industryNav];
}
