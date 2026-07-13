export interface WidgetDef {
  key: string;
  label: string;
  description: string;
}

export type WidgetSize = "stat" | "half" | "full";

export const WIDGET_CATALOG: WidgetDef[] = [
  { key: "stats",              label: "Stats cards",        description: "Total / New / Contacted / Enrolled / Rejected" },
  { key: "leads-by-stage",     label: "Leads by Status",    description: "Donut of leads grouped by status" },
  { key: "leads-by-source",    label: "Leads by Source",    description: "Top sources / forms" },
  { key: "leads-by-counselor", label: "Leads by Counselor", description: "Per-counselor lead counts" },
  { key: "utm",                label: "UTM Attribution",    description: "Source / Medium / Campaign breakdown" },
  // it_agency delivery widgets — self-fetching, see dashboard-renderer.tsx
  { key: "delivery-health",        label: "Delivery Health",         description: "RAG status across the project portfolio" },
  { key: "projects-by-status",     label: "Projects by Status",      description: "Donut of projects grouped by status" },
  { key: "team-utilization",       label: "Team Utilization",        description: "Per-member utilization vs. the target band" },
  { key: "who-working-on-what",    label: "Who's Working on What",   description: "In-progress tasks grouped by assignee" },
  { key: "task-progress",          label: "Task Progress",           description: "Todo / In Progress / Done breakdown" },
  { key: "approvals-pending",      label: "Approvals Pending",       description: "Time, milestone and change-request approvals awaiting review" },
  { key: "delivery-by-department", label: "Delivery by Department",  description: "Hours and billable amount per department" },
  // it_agency delivery control widgets (Phase 2) — self-fetching, reuse existing endpoints
  { key: "delivery-overrun",       label: "Estimate vs Actual / Overrun", description: "Which projects are burning past their estimate" },
  { key: "delivery-bench",         label: "Bench / Idle Capacity",   description: "Under-utilized members, sorted by idle hours" },
  { key: "delivery-overdue-tasks", label: "Overdue Tasks",           description: "Past-due tasks grouped by assignee" },
  { key: "delivery-scope-creep",   label: "Scope-Creep Meter",       description: "Change-request volume and added scope hours" },
  { key: "my-utilization",         label: "My Utilization",          description: "Your utilization vs. the target band" },
  { key: "my-tasks",               label: "My Tasks",                description: "Your tasks by status and what's due soon" },
  { key: "my-time",                label: "My Time This Week",       description: "Your hours and billable amount this period" },
  // it_agency sales widgets — self-fetching, server-side aggregation (see dashboard-renderer.tsx)
  { key: "sales-leads-trend",      label: "New Leads Over Time",     description: "Leads created per week, last 12 weeks" },
  { key: "sales-leads-by-source",  label: "Leads by Source",         description: "Which channels produce volume" },
  { key: "sales-funnel",           label: "Pipeline by Stage",       description: "Leads by Stage, ordered — where leads pile up" },
  { key: "sales-leads-by-owner",   label: "Leads by Owner",          description: "Lead distribution across the team" },
  { key: "sales-aging",            label: "Aging / Stale Leads",     description: "Open leads bucketed by days since last activity" },
  { key: "sales-deals-summary",    label: "Deals Snapshot",          description: "Win rate, weighted pipeline, bookings won (MTD)" },
  // it_agency sales depth widgets (Phase 1.5) — self-fetching, server-side aggregation
  { key: "sales-conversion",       label: "Stage Conversion",        description: "Step-down conversion % between consecutive stages" },
  { key: "sales-cycle",            label: "Sales Cycle Length",      description: "Avg/median days from lead creation to conversion" },
  { key: "sales-proposals",        label: "Proposal Engagement",     description: "Status mix, viewed count, acceptance rate, time-to-view/accept" },
  { key: "sales-first-contact",    label: "Time to First Contact",   description: "Avg/median hours from lead creation to first logged activity" },
  { key: "sales-win-loss",         label: "Win / Loss",              description: "Won vs lost deal counts and value" },
  // it_agency Company Overview widgets (Phase 3) — self-fetching, bird's-eye
  // tile rows that bubble up Sales + Delivery, no new fetch surface.
  { key: "overview-sales",         label: "Sales Overview",          description: "New leads, weighted pipeline, win rate, bookings won" },
  { key: "overview-delivery",      label: "Delivery Overview",       description: "Delivery health, over-budget projects, team utilization, bench" },
];

export const WIDGET_KEYS = WIDGET_CATALOG.map((w) => w.key);

// Tile size drives the layout grouping in dashboard-view.tsx: consecutive
// widgets of the same size are grouped into one row. Lead-widget sizes
// reproduce the pre-Phase-2 grouping exactly (chart trio => "half", stats/utm
// standalone => "full") so education dashboards render unchanged.
export const WIDGET_SIZE: Record<string, WidgetSize> = {
  stats: "full",
  "leads-by-stage": "half",
  "leads-by-source": "half",
  "leads-by-counselor": "half",
  utm: "full",
  "delivery-health": "full",
  "projects-by-status": "half",
  "team-utilization": "full",
  "who-working-on-what": "full",
  "task-progress": "half",
  "approvals-pending": "stat",
  "delivery-by-department": "full",
  "delivery-overrun": "full",
  "delivery-bench": "half",
  "delivery-overdue-tasks": "half",
  "delivery-scope-creep": "half",
  "my-utilization": "stat",
  "my-tasks": "half",
  "my-time": "stat",
  "sales-leads-trend": "full",
  "sales-leads-by-source": "half",
  "sales-funnel": "full",
  "sales-leads-by-owner": "half",
  "sales-aging": "half",
  "sales-deals-summary": "full",
  "sales-conversion": "full",
  "sales-cycle": "half",
  "sales-proposals": "full",
  "sales-first-contact": "half",
  "sales-win-loss": "half",
  "overview-sales": "full",
  "overview-delivery": "full",
};

// Personal widgets (my-utilization, my-tasks, my-time) are intentionally excluded —
// company dashboards are company-scope only; those widgets live on Home instead
// (see home-content.tsx). Their entries stay in WIDGET_CATALOG/WIDGET_SIZE/
// DELIVERY_WIDGETS so pre-existing dashboard rows don't render a null until
// migration 145 strips them out.
const IT_AGENCY_WIDGET_KEYS = new Set([
  "stats",
  "leads-by-stage",
  "leads-by-source",
  "delivery-health",
  "projects-by-status",
  "team-utilization",
  "who-working-on-what",
  "task-progress",
  "approvals-pending",
  "delivery-by-department",
  "delivery-overrun",
  "delivery-bench",
  "delivery-overdue-tasks",
  "delivery-scope-creep",
  "sales-leads-trend",
  "sales-leads-by-source",
  "sales-funnel",
  "sales-leads-by-owner",
  "sales-aging",
  "sales-deals-summary",
  "sales-conversion",
  "sales-cycle",
  "sales-proposals",
  "sales-first-contact",
  "sales-win-loss",
  "overview-sales",
  "overview-delivery",
]);

const LEAD_WIDGET_KEYS = new Set(["stats", "leads-by-stage", "leads-by-source", "leads-by-counselor", "utm"]);

export function getWidgetCatalog(industryId: string | null): WidgetDef[] {
  const allowed = industryId === "it_agency" ? IT_AGENCY_WIDGET_KEYS : LEAD_WIDGET_KEYS;
  return WIDGET_CATALOG.filter((w) => allowed.has(w.key));
}
