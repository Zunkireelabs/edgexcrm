"use client";

import { StatsCards } from "@/components/dashboard/stats-cards";
import {
  LeadsByStageChart,
  LeadsBySourceChart,
  LeadsByCounselorChart,
} from "@/components/dashboard/charts";
import { UtmAnalyticsSection } from "@/industries/education-consultancy/features/utm-analytics/components/utm-analytics-section";
import type { Lead, PipelineStage } from "@/types/database";

interface DashboardRendererProps {
  widgetKey: string;
  leads: Lead[];
  stages: PipelineStage[];
  memberMap: Record<string, string>;
  formMap: Record<string, string>;
}

export function DashboardRenderer({
  widgetKey,
  leads,
  stages,
  memberMap,
  formMap,
}: DashboardRendererProps) {
  switch (widgetKey) {
    case "stats":
      return <StatsCards leads={leads} />;
    case "leads-by-stage":
      return <LeadsByStageChart leads={leads} stages={stages} />;
    case "leads-by-source":
      return <LeadsBySourceChart leads={leads} formMap={formMap} />;
    case "leads-by-counselor":
      return <LeadsByCounselorChart leads={leads} memberMap={memberMap} />;
    case "utm":
      return <UtmAnalyticsSection leads={leads} />;
    default:
      return null;
  }
}
