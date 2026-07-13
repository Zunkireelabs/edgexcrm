"use client";

import React from "react";
import { DashboardRenderer } from "../components/dashboard-renderer";
import { DashboardSwitcher } from "../components/dashboard-switcher";
import { WIDGET_SIZE, type WidgetSize } from "../lib/widget-catalog";
import type { Dashboard, Lead, PipelineStage } from "@/types/database";

// "stat" and "half" widgets group with consecutive same-size widgets into a
// row; "full" always stands alone. Lead-widget sizes reproduce the pre-Phase-2
// grouping exactly (see widget-catalog.ts) so education dashboards are
// visually unchanged by this generalization.
const GROUP_CLASS: Partial<Record<WidgetSize, string>> = {
  stat: "grid grid-cols-2 md:grid-cols-4 gap-4",
  half: "grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-6",
};

interface RendererProps {
  leads: Lead[];
  stages: PipelineStage[];
  memberMap: Record<string, string>;
  memberNames?: Record<string, string>;
  formMap: Record<string, string>;
  currentUserId?: string | null;
  currentTenantUserId?: string | null;
  industryId?: string | null;
}

function renderWidgets(widgets: string[], props: RendererProps) {
  const result: React.ReactNode[] = [];
  let i = 0;

  while (i < widgets.length) {
    const key = widgets[i];
    const size = WIDGET_SIZE[key] ?? "full";
    const groupClass = GROUP_CLASS[size];

    if (groupClass) {
      const group: string[] = [];
      while (i < widgets.length && (WIDGET_SIZE[widgets[i]] ?? "full") === size) {
        group.push(widgets[i]);
        i++;
      }
      result.push(
        <div key={`${size}-group-${group[0]}`} className={groupClass}>
          {group.map((k) => (
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
  industryId: string | null;
  currentUserId?: string | null;
  currentTenantUserId?: string | null;
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
  industryId,
  currentUserId,
  currentTenantUserId,
}: DashboardViewProps) {
  return (
    <div className="space-y-6">
      <DashboardSwitcher
        dashboards={visibleDashboards}
        currentDashboard={dashboard}
        canManage={canManage}
        industryId={industryId}
      />

      {dashboard.description && (
        <p className="text-sm text-gray-500">{dashboard.description}</p>
      )}

      {dashboard.widgets.length === 0 ? (
        <p className="text-gray-500">This dashboard has no widgets configured.</p>
      ) : (
        <div className="space-y-6">
          {renderWidgets(dashboard.widgets, {
            leads,
            stages,
            memberMap,
            memberNames,
            formMap,
            currentUserId,
            currentTenantUserId,
            industryId,
          })}
        </div>
      )}
    </div>
  );
}
