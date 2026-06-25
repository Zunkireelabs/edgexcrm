"use client";

import React from "react";
import { DashboardRenderer } from "../components/dashboard-renderer";
import { DashboardSwitcher } from "../components/dashboard-switcher";
import type { Dashboard, Lead, PipelineStage } from "@/types/database";

const CHART_KEYS = new Set(["leads-by-stage", "leads-by-source", "leads-by-counselor"]);

interface RendererProps {
  leads: Lead[];
  stages: PipelineStage[];
  memberMap: Record<string, string>;
  memberNames?: Record<string, string>;
  formMap: Record<string, string>;
}

function renderWidgets(widgets: string[], props: RendererProps) {
  const result: React.ReactNode[] = [];
  let i = 0;

  while (i < widgets.length) {
    const key = widgets[i];

    if (CHART_KEYS.has(key)) {
      const chartGroup: string[] = [];
      while (i < widgets.length && CHART_KEYS.has(widgets[i])) {
        chartGroup.push(widgets[i]);
        i++;
      }
      result.push(
        <div
          key={`chart-group-${chartGroup[0]}`}
          className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-6"
        >
          {chartGroup.map((k) => (
            <DashboardRenderer key={k} widgetKey={k} {...props} />
          ))}
        </div>
      );
    } else {
      result.push(
        <DashboardRenderer key={key} widgetKey={key} {...props} />
      );
      i++;
    }
  }

  return result;
}

interface DashboardViewProps {
  dashboard: Dashboard;
  leads: Lead[];
  stages: PipelineStage[];
  memberMap: Record<string, string>;
  memberNames?: Record<string, string>;
  formMap: Record<string, string>;
  visibleDashboards: Dashboard[];
  canManage: boolean;
}

export function DashboardView({
  dashboard,
  leads,
  stages,
  memberMap,
  memberNames,
  formMap,
  visibleDashboards,
  canManage,
}: DashboardViewProps) {
  return (
    <div className="space-y-6">
      <DashboardSwitcher
        dashboards={visibleDashboards}
        currentDashboard={dashboard}
        canManage={canManage}
      />

      {dashboard.description && (
        <p className="text-sm text-gray-500">{dashboard.description}</p>
      )}

      {dashboard.widgets.length === 0 ? (
        <p className="text-gray-500">This dashboard has no widgets configured.</p>
      ) : (
        <div className="space-y-6">
          {renderWidgets(dashboard.widgets, { leads, stages, memberMap, memberNames, formMap })}
        </div>
      )}
    </div>
  );
}
