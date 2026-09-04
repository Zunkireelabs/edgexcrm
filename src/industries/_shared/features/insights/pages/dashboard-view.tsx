"use client";

import React from "react";
import { DashboardRenderer } from "../components/dashboard-renderer";
import { DashboardSwitcher } from "../components/dashboard-switcher";
import { DateRangeFilter } from "../components/date-range-filter";
import { WIDGET_SIZE, WIDGET_RELEVANT_KPIS, type WidgetSize } from "../lib/widget-catalog";
import { KpiTile } from "@/components/dashboard/stats-cards";
import type { Dashboard, LeadList, PipelineStage } from "@/types/database";
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
// A row of exactly two "half" widgets only fills 2 of ROW_GRID_CLASS's 3 xl
// columns, leaving a blank third column instead of splitting 50/50 on wide
// screens. Give that specific case its own 2-column grid so it always
// renders as a true 50/50 split, at every breakpoint.
const TWO_HALF_ROW_GRID_CLASS = "grid grid-cols-1 lg:grid-cols-2 gap-6";

// Applied to a "wide" widget's own wrapper so it spans 2 of the 3 row columns.
const WIDE_ITEM_CLASS = "flex flex-col [&>*]:flex-1 lg:col-span-2 xl:col-span-2";

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
  lists: LeadList[];
  /** Status-view color lookup only — see LeadsByStageChart's `stages` prop docstring. */
  stages: PipelineStage[];
  memberMap: Record<string, string>;
  memberNames?: Record<string, string>;
  currentUserId?: string | null;
  currentTenantUserId?: string | null;
  industryId?: string | null;
  hideTrend?: boolean;
}

// Auto-derives which KPI tiles are relevant to the content widgets actually on this
// dashboard (see WIDGET_RELEVANT_KPIS) — not itself a widget, so it's never part of
// dashboard.widgets and never a manual checkbox in the builder. This is what makes
// picking "Leads by Status" for a dashboard automatically surface its relevant KPI row,
// instead of a fixed 9-tile block or a separate per-KPI widget the user has to add.
// Skipped when the full "stats" block is already on the dashboard, so the row never
// duplicates it.
function relevantKpiKeys(widgets: string[]): string[] {
  if (widgets.includes("stats")) return [];
  const keys = new Set<string>();
  for (const w of widgets) {
    for (const k of WIDGET_RELEVANT_KPIS[w] ?? []) keys.add(k);
  }
  return Array.from(keys);
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
      const isTwoHalfRow = group.length === 2 && group.every((w) => w.size === "half");
      result.push(
        <div key={`row-group-${group[0].key}`} className={isTwoHalfRow ? TWO_HALF_ROW_GRID_CLASS : ROW_GRID_CLASS}>
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
  lists: LeadList[];
  /** Status-view color lookup only — see LeadsByStageChart's `stages` prop docstring. */
  stages: PipelineStage[];
  memberMap: Record<string, string>;
  memberNames?: Record<string, string>;
  visibleDashboards: Dashboard[];
  canManage: boolean;
  industryId: string | null;
  currentUserId?: string | null;
  currentTenantUserId?: string | null;
  /** True when the `?from=` search param resolved to something other than "all" —
   * see date-range-presets.ts. Suppresses trend badges tenant-wide on this render,
   * since the RPC's week buckets don't respect the filter. */
  dateFilterActive?: boolean;
}

export function DashboardView({
  dashboard,
  aggregates,
  sourceCounts,
  utmRows,
  lists,
  stages,
  memberMap,
  memberNames,
  visibleDashboards,
  canManage,
  industryId,
  currentUserId,
  currentTenantUserId,
  dateFilterActive,
}: DashboardViewProps) {
  const kpiKeys = relevantKpiKeys(dashboard.widgets);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between gap-2">
        <DashboardSwitcher
          dashboards={visibleDashboards}
          currentDashboard={dashboard}
          canManage={canManage}
          industryId={industryId}
        />
        <DateRangeFilter />
      </div>

      {dashboard.description && (
        <p className="text-sm text-gray-500">{dashboard.description}</p>
      )}

      {dashboard.widgets.length === 0 ? (
        <p className="text-gray-500">This dashboard has no widgets configured.</p>
      ) : (
        <div className="space-y-6">
          {kpiKeys.length > 0 && (
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              {kpiKeys.map((k) => (
                <KpiTile
                  key={k}
                  metricKey={k}
                  aggregates={aggregates}
                  teamMemberCount={Object.keys(memberMap).length}
                  activeSourceCount={Object.keys(sourceCounts).length}
                  hideTrend={dateFilterActive}
                />
              ))}
            </div>
          )}
          {renderWidgets(dashboard.widgets, {
            aggregates,
            sourceCounts,
            utmRows,
            lists,
            stages,
            memberMap,
            memberNames,
            currentUserId,
            currentTenantUserId,
            industryId,
            hideTrend: dateFilterActive,
          })}
        </div>
      )}
    </div>
  );
}
