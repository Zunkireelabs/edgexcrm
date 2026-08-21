"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { FunnelChart, type FunnelStage } from "@/components/ui/funnel-chart";
import type { LeadList } from "@/types/database";

// Default chart colors for lists without an explicit `color` set.
const CHART_COLORS = [
  "#3B82F6", // Blue
  "#22C55E", // Green
  "#F59E0B", // Amber
  "#8B5CF6", // Purple
  "#EC4899", // Pink
  "#06B6D4", // Cyan
  "#84CC16", // Lime
];

const NONE_KEY = "(none)";

// Keep the funnel within the 3-8 stage range chart guidance calls "optimal" —
// beyond that, group the smallest Stages into a synthetic "Other" bucket.
const MAX_STAGES = 7;

// Floor for the sqrt-scaled visual size, as a fraction of the top stage's value —
// keeps a tiny Stage visible as a real segment instead of collapsing to nothing,
// without ever changing the true count/percentage shown.
const VISUAL_FLOOR_RATIO = 0.12;

interface LeadsByListChartProps {
  /** list_id-keyed counts ("(none)" sentinel for leads with no list) — see LeadAggregates.list. */
  list: Record<string, number>;
  /** Tenant's lead_lists rows — the "Stage" the leads app UI shows (see CLAUDE.md's
   * "Lead Lists = Stage in UI" note). Sorted by sort_order to keep the funnel's
   * left-to-right order matching the Stage dropdown. */
  lists: LeadList[];
}

interface ListDatum {
  name: string;
  value: number;
  key: string;
  color: string | null;
}

function formatPercentage(value: number, base: number): string {
  if (base <= 0) return "0%";
  const pct = (value / base) * 100;
  if (pct === 0) return "0%";
  if (pct < 1) return "<1%";
  if (pct >= 99.95) return "100%";
  return `${pct.toFixed(1).replace(/\.0$/, "")}%`;
}

export function LeadsByListChart({ list, lists }: LeadsByListChartProps) {
  // Archived and staging (pre-routing intake dump) lists aren't part of the
  // Stage funnel this widget shows — leave them out. `is_system` is NOT a
  // signal to exclude: the core Stage lists (Pre-qualified, Qualified,
  // Prospects, Applications) are themselves system lists.
  const visibleLists = [...lists]
    .filter((l) => !l.is_archive && !l.is_staging)
    .sort((a, b) => a.sort_order - b.sort_order);

  const sorted: ListDatum[] = visibleLists
    .map((l) => ({ name: l.name, value: list[l.id] ?? 0, key: l.id, color: l.color }))
    .filter((d) => d.value > 0);

  const data: ListDatum[] =
    sorted.length > MAX_STAGES
      ? [
          ...sorted.slice(0, MAX_STAGES - 1),
          {
            name: "Other",
            key: NONE_KEY,
            color: null,
            value: sorted.slice(MAX_STAGES - 1).reduce((sum, d) => sum + d.value, 0),
          },
        ]
      : sorted;

  const getColor = (color: string | null, index: number): string => color ?? CHART_COLORS[index % CHART_COLORS.length];

  if (data.length === 0) {
    return (
      <Card className="border-0 shadow-sm">
        <CardHeader>
          <CardTitle className="text-sm font-medium uppercase tracking-wide text-muted-foreground">
            Leads by Stage
          </CardTitle>
        </CardHeader>
        <CardContent className="flex items-center justify-center h-[250px]">
          <p className="text-muted-foreground">No leads data available</p>
        </CardContent>
      </Card>
    );
  }

  const topValue = data[0].value;
  const maxValue = Math.max(...data.map((d) => d.value), 1);
  const visualValue = (value: number) => {
    const ratio = Math.sqrt(value) / Math.sqrt(maxValue);
    return Math.max(maxValue * VISUAL_FLOOR_RATIO, maxValue * ratio);
  };

  const dropOffPct = (i: number): number | null => {
    if (i === 0) return null;
    const prev = data[i - 1].value;
    if (prev <= 0) return null;
    return 100 - (data[i].value / prev) * 100;
  };
  const dropOffs = data.map((_, i) => dropOffPct(i));

  const funnelData: FunnelStage[] = data.map((entry, index) => ({
    label: entry.name,
    value: entry.value,
    visualValue: visualValue(entry.value),
    displayValue: entry.value.toLocaleString(),
    color: getColor(entry.color, index),
  }));

  return (
    <Card className="border-0 shadow-sm">
      <CardHeader>
        <CardTitle className="text-sm font-medium uppercase tracking-wide text-muted-foreground">
          Leads by Stage
        </CardTitle>
      </CardHeader>
      <CardContent>
        <FunnelChart
          data={funnelData}
          orientation="horizontal"
          layers={3}
          edges="curved"
          grid={{ lineColor: "var(--border)" }}
          formatPercentage={(pct) => {
            if (pct === 0) return "0%";
            if (pct < 1) return "<1%";
            if (pct >= 99.95) return "100%";
            return `${pct.toFixed(1).replace(/\.0$/, "")}%`;
          }}
          formatValue={(v) => v.toLocaleString()}
        />

        {/* Screen-reader fallback: the animated SVG carries no semantics on its own */}
        <ul className="sr-only">
          {data.map((entry, index) => (
            <li key={entry.key}>
              {entry.name}: {entry.value.toLocaleString()} leads, {formatPercentage(entry.value, topValue)} of {data[0].name}
              {dropOffs[index] !== null &&
                `, down ${dropOffs[index]!.toFixed(1)}% from ${data[index - 1].name}`}
            </li>
          ))}
        </ul>
      </CardContent>
    </Card>
  );
}
