"use client";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { FunnelChart, type FunnelStage } from "@/components/ui/funnel-chart";
import type { PipelineStage } from "@/types/database";
import type { WeekBucketCounts } from "@/lib/leads/aggregates";

// Status colors matching the theme
const STATUS_COLORS: Record<string, string> = {
  new: "#3B82F6",      // Blue
  contacted: "#F59E0B", // Amber
  enrolled: "#22C55E",  // Green
  rejected: "#EF4444",  // Red
};

// Default chart colors for custom stages
const CHART_COLORS = [
  "#3B82F6", // Blue
  "#22C55E", // Green
  "#F59E0B", // Amber
  "#8B5CF6", // Purple
  "#EC4899", // Pink
  "#06B6D4", // Cyan
  "#84CC16", // Lime
];

const OTHER_COLOR = "#94A3B8"; // Slate — neutral bucket for overflow statuses
const OTHER_KEY = "__other__";

// Keep the funnel within the 3-8 stage range chart guidance calls "optimal" —
// beyond that, group the smallest statuses into a synthetic "Other" bucket.
const MAX_STAGES = 7;

// Floor for the sqrt-scaled visual size, as a fraction of the top stage's value —
// keeps a tiny status (e.g. 1 lead vs. 16,558) visible as a real segment instead
// of collapsing to nothing, without ever changing the true count/percentage shown.
const VISUAL_FLOOR_RATIO = 0.12;

interface LeadsByStageChartProps {
  status: Record<string, WeekBucketCounts>;
  stages?: PipelineStage[];
}

interface StatusDatum {
  name: string;
  value: number;
  status: string;
}

function formatPercentage(value: number, base: number): string {
  if (base <= 0) return "0%";
  const pct = (value / base) * 100;
  if (pct === 0) return "0%";
  if (pct < 1) return "<1%";
  if (pct >= 99.95) return "100%";
  return `${pct.toFixed(1).replace(/\.0$/, "")}%`;
}

export function LeadsByStageChart({ status, stages }: LeadsByStageChartProps) {
  // Group leads by status (pre-aggregated — see migration 194's `status` dimension)
  const statusCounts: Record<string, number> = {};
  for (const [key, bucket] of Object.entries(status)) {
    if (bucket.all > 0) statusCounts[key] = bucket.all;
  }

  const sorted = Object.entries(statusCounts)
    .map(([key, count]) => ({
      name: key.charAt(0).toUpperCase() + key.slice(1),
      value: count,
      status: key,
    }))
    .sort((a, b) => b.value - a.value);

  const data: StatusDatum[] =
    sorted.length > MAX_STAGES
      ? [
          ...sorted.slice(0, MAX_STAGES - 1),
          {
            name: "Other",
            status: OTHER_KEY,
            value: sorted.slice(MAX_STAGES - 1).reduce((sum, d) => sum + d.value, 0),
          },
        ]
      : sorted;

  const getColor = (statusKey: string, index: number): string => {
    if (statusKey === OTHER_KEY) return OTHER_COLOR;
    if (STATUS_COLORS[statusKey]) return STATUS_COLORS[statusKey];
    if (stages) {
      const stage = stages.find((s) => s.slug === statusKey || s.name.toLowerCase() === statusKey);
      if (stage?.color) return stage.color;
    }
    return CHART_COLORS[index % CHART_COLORS.length];
  };

  if (data.length === 0) {
    return (
      <Card className="border-0 shadow-sm">
        <CardHeader>
          <CardTitle className="text-sm font-medium uppercase tracking-wide text-muted-foreground">
            Leads by Status
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
    color: getColor(entry.status, index),
  }));

  return (
    <Card className="border-0 shadow-sm">
      <CardHeader>
        <CardTitle className="text-sm font-medium uppercase tracking-wide text-muted-foreground">
          Leads by Status
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
            <li key={entry.status}>
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
