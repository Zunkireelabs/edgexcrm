"use client";

import React from "react";
import { DashboardRenderer } from "../components/dashboard-renderer";
import { DashboardSwitcher } from "../components/dashboard-switcher";
import { WIDGET_SIZE, type WidgetSize } from "../lib/widget-catalog";
import type { Dashboard, PipelineStage } from "@/types/database";
import type { LeadAggregates } from "@/lib/leads/aggregates";
import type { LeadUtmRow } from "@/lib/supabase/queries";

// "stat" widgets group with consecutive same-size widgets into their own row.
// "half" and "wide" share a 3-column row grid and pack together by column
// units ("wide" = 2 units, "half" = 1 unit) until the row fills or a
// different-sized widget is reached — see packRowGroup below. "full" always
// stands alone.
const GROUP_CLASS: Partial<Record<WidgetSize, string>> = {
  stat: "grid grid-cols-2 md:grid-cols-4 gap-4",
};
const ROW_GRID_CLASS = "grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-6";

// Applied to a "wide" widget's own wrapper so it spans 2 of the 3 row columns.
const WIDE_ITEM_CLASS = "lg:col-span-2 xl:col-span-2";

const ROW_UNITS: Partial<Record<WidgetSize, number>> = { wide: 2, half: 1 };
const ROW_CAPACITY = 3;

// Packs consecutive "wide"/"half" widgets into one 3-column row by column
// units, so e.g. a "wide" (2 units) leads-by-stage widget shares a row with a
// following "half" (1 unit) widget instead of leaving the 3rd column blank.
function packRowGroup(widgets: string[], start: number) {
  const group: { key: string; size: WidgetSize }[] = [];
  let units = 0;
  let i = start;
  while (i < widgets.length) {
    const size = WIDGET_SIZE[widgets[i]] ?? "full";
    const unit = ROW_UNITS[size];
    if (unit === undefined || units + unit > ROW_CAPACITY) break;
    group.push({ key: widgets[i], size });
    units += unit;
    i++;
    if (units === ROW_CAPACITY) break;
  }
  return { group, nextIndex: i };
}

interface RendererProps {
  aggregates: LeadAggregates;
  sourceCounts: Record<string, number>;
  utmRows: LeadUtmRow[];
  stages: PipelineStage[];
  memberMap: Record<string, string>;
  memberNames?: Record<string, string>;
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

    if (size === "wide" || size === "half") {
      const { group, nextIndex } = packRowGroup(widgets, i);
      i = nextIndex;
      result.push(
        <div key={`row-group-${group[0].key}`} className={ROW_GRID_CLASS}>
          {group.map(({ key: k, size: s }) =>
            s === "wide" ? (
              <div key={k} className={WIDE_ITEM_CLASS}>
                <DashboardRenderer widgetKey={k} {...props} />
              </div>
            ) : (
              <DashboardRenderer key={k} widgetKey={k} {...props} />
            )
          )}
        </div>
      );
      continue;
    }

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
  aggregates: LeadAggregates;
  sourceCounts: Record<string, number>;
  utmRows: LeadUtmRow[];
  stages: PipelineStage[];
  memberMap: Record<string, string>;
  memberNames?: Record<string, string>;
  visibleDashboards: Dashboard[];
  canManage: boolean;
  industryId: string | null;
  currentUserId?: string | null;
  currentTenantUserId?: string | null;
}

export function DashboardView({
  dashboard,
  aggregates,
  sourceCounts,
  utmRows,
  stages,
  memberMap,
  memberNames,
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
            aggregates,
            sourceCounts,
            utmRows,
            stages,
            memberMap,
            memberNames,
            currentUserId,
            currentTenantUserId,
            industryId,
          })}
        </div>
      )}
    </div>
  );
}
