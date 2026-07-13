"use client";

import dynamic from "next/dynamic";
import type { ComponentType } from "react";
import { StatsCards } from "@/components/dashboard/stats-cards";
import {
  LeadsByStageChart,
  LeadsBySourceChart,
  LeadsByCounselorChart,
} from "@/components/dashboard/charts";
import { UtmAnalyticsSection } from "@/industries/education-consultancy/features/utm-analytics/components/utm-analytics-section";
import type { Lead, PipelineStage } from "@/types/database";
import type { DeliveryWidgetProps } from "@/industries/it-agency/features/delivery-dashboard/widgets/types";

// Accepted trade-off: this makes `_shared` import `it_agency` widget code
// (dynamically, so non-it_agency bundles don't grow) — the same coupling the
// `utm` case above has with education. A proper per-industry widget-component
// registry is a future cleanup, out of scope for this phase.
const DELIVERY_WIDGETS: Record<string, ComponentType<DeliveryWidgetProps>> = {
  "delivery-health": dynamic(
    () => import("@/industries/it-agency/features/delivery-dashboard/widgets/delivery-health")
  ),
  "projects-by-status": dynamic(
    () => import("@/industries/it-agency/features/delivery-dashboard/widgets/projects-by-status")
  ),
  "team-utilization": dynamic(
    () => import("@/industries/it-agency/features/delivery-dashboard/widgets/team-utilization")
  ),
  "who-working-on-what": dynamic(
    () => import("@/industries/it-agency/features/delivery-dashboard/widgets/who-working-on-what")
  ),
  "task-progress": dynamic(
    () => import("@/industries/it-agency/features/delivery-dashboard/widgets/task-progress")
  ),
  "approvals-pending": dynamic(
    () => import("@/industries/it-agency/features/delivery-dashboard/widgets/approvals-pending")
  ),
  "delivery-by-department": dynamic(
    () => import("@/industries/it-agency/features/delivery-dashboard/widgets/delivery-by-department")
  ),
  "my-tasks": dynamic(
    () => import("@/industries/it-agency/features/delivery-dashboard/widgets/my-tasks")
  ),
  "my-utilization": dynamic(
    () => import("@/industries/it-agency/features/delivery-dashboard/widgets/my-utilization")
  ),
  "my-time": dynamic(
    () => import("@/industries/it-agency/features/delivery-dashboard/widgets/my-time")
  ),
  "delivery-overrun": dynamic(
    () => import("@/industries/it-agency/features/delivery-dashboard/widgets/delivery-overrun")
  ),
  "delivery-bench": dynamic(
    () => import("@/industries/it-agency/features/delivery-dashboard/widgets/delivery-bench")
  ),
  "delivery-overdue-tasks": dynamic(
    () => import("@/industries/it-agency/features/delivery-dashboard/widgets/delivery-overdue-tasks")
  ),
  "delivery-scope-creep": dynamic(
    () => import("@/industries/it-agency/features/delivery-dashboard/widgets/delivery-scope-creep")
  ),
};

// Sales & Outreach dashboard widgets — self-fetching, server-side aggregation
// (see the sales-dashboard widgets' RPC-backed /api/v1/insights/sales/* endpoints).
// Same defense-in-depth as DELIVERY_WIDGETS: only resolved for it_agency below.
// These widgets take no props — counselor scoping happens server-side from the
// authenticated session, not a client-passed currentUserId.
const SALES_WIDGETS: Record<string, ComponentType<DeliveryWidgetProps>> = {
  "sales-leads-trend": dynamic(
    () => import("@/industries/it-agency/features/sales-dashboard/widgets/sales-leads-trend")
  ),
  "sales-leads-by-source": dynamic(
    () => import("@/industries/it-agency/features/sales-dashboard/widgets/sales-leads-by-source")
  ),
  "sales-funnel": dynamic(
    () => import("@/industries/it-agency/features/sales-dashboard/widgets/sales-funnel")
  ),
  "sales-leads-by-owner": dynamic(
    () => import("@/industries/it-agency/features/sales-dashboard/widgets/sales-leads-by-owner")
  ),
  "sales-aging": dynamic(
    () => import("@/industries/it-agency/features/sales-dashboard/widgets/sales-aging")
  ),
  "sales-deals-summary": dynamic(
    () => import("@/industries/it-agency/features/sales-dashboard/widgets/sales-deals-summary")
  ),
  "sales-conversion": dynamic(
    () => import("@/industries/it-agency/features/sales-dashboard/widgets/sales-conversion")
  ),
  "sales-cycle": dynamic(
    () => import("@/industries/it-agency/features/sales-dashboard/widgets/sales-cycle")
  ),
  "sales-proposals": dynamic(
    () => import("@/industries/it-agency/features/sales-dashboard/widgets/sales-proposals")
  ),
  "sales-first-contact": dynamic(
    () => import("@/industries/it-agency/features/sales-dashboard/widgets/sales-first-contact")
  ),
  "sales-win-loss": dynamic(
    () => import("@/industries/it-agency/features/sales-dashboard/widgets/sales-win-loss")
  ),
};

// Company Overview widgets (Phase 3) — bird's-eye tile rows that bubble up
// Sales + Delivery. Same defense-in-depth as DELIVERY_WIDGETS/SALES_WIDGETS:
// only resolved for it_agency below.
const OVERVIEW_WIDGETS: Record<string, ComponentType<DeliveryWidgetProps>> = {
  "overview-sales": dynamic(
    () => import("@/industries/it-agency/features/overview-dashboard/widgets/overview-sales")
  ),
  "overview-delivery": dynamic(
    () => import("@/industries/it-agency/features/overview-dashboard/widgets/overview-delivery")
  ),
};

interface DashboardRendererProps {
  widgetKey: string;
  leads: Lead[];
  stages: PipelineStage[];
  memberMap: Record<string, string>;
  memberNames?: Record<string, string>;
  formMap: Record<string, string>;
  currentUserId?: string | null;
  currentTenantUserId?: string | null;
  industryId?: string | null;
}

export function DashboardRenderer({
  widgetKey,
  leads,
  stages,
  memberMap,
  memberNames,
  formMap,
  currentUserId,
  currentTenantUserId,
  industryId,
}: DashboardRendererProps) {
  // Defense-in-depth: delivery widgets only resolve for it_agency dashboards,
  // even if a delivery key somehow ends up in a non-it_agency dashboard's
  // widgets array (getWidgetCatalog already prevents this at selection time).
  const DeliveryWidget = industryId === "it_agency" ? DELIVERY_WIDGETS[widgetKey] : undefined;
  if (DeliveryWidget) {
    return <DeliveryWidget currentUserId={currentUserId} currentTenantUserId={currentTenantUserId} />;
  }

  // Defense-in-depth: sales widgets only resolve for it_agency dashboards, even if
  // a sales key somehow ends up in a non-it_agency dashboard's widgets array
  // (getWidgetCatalog already prevents this at selection time).
  const SalesWidget = industryId === "it_agency" ? SALES_WIDGETS[widgetKey] : undefined;
  if (SalesWidget) {
    return <SalesWidget />;
  }

  // Defense-in-depth: overview widgets only resolve for it_agency dashboards, even
  // if an overview key somehow ends up in a non-it_agency dashboard's widgets array
  // (getWidgetCatalog already prevents this at selection time).
  const OverviewWidget = industryId === "it_agency" ? OVERVIEW_WIDGETS[widgetKey] : undefined;
  if (OverviewWidget) {
    return <OverviewWidget />;
  }

  switch (widgetKey) {
    case "stats":
      return <StatsCards leads={leads} />;
    case "leads-by-stage":
      return <LeadsByStageChart leads={leads} stages={stages} />;
    case "leads-by-source":
      return <LeadsBySourceChart leads={leads} formMap={formMap} />;
    case "leads-by-counselor":
      return <LeadsByCounselorChart leads={leads} memberMap={memberMap} memberNames={memberNames} />;
    case "utm":
      return <UtmAnalyticsSection leads={leads} />;
    default:
      return null;
  }
}
