export interface WidgetDef {
  key: string;
  label: string;
  description: string;
}

export const WIDGET_CATALOG: WidgetDef[] = [
  { key: "stats",              label: "Stats cards",        description: "Total / New / Contacted / Enrolled / Rejected" },
  { key: "leads-by-stage",     label: "Leads by Status",    description: "Donut of leads grouped by status" },
  { key: "leads-by-source",    label: "Leads by Source",    description: "Top sources / forms" },
  { key: "leads-by-counselor", label: "Leads by Counselor", description: "Per-counselor lead counts" },
  { key: "utm",                label: "UTM Attribution",    description: "Source / Medium / Campaign breakdown" },
];

export const WIDGET_KEYS = WIDGET_CATALOG.map((w) => w.key);
