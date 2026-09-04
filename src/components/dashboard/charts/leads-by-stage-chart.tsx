"use client";

import { useState } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { FunnelChart, type FunnelStage } from "@/components/ui/funnel-chart";
import type { LeadList, PipelineStage } from "@/types/database";
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

// Floor for the log-scaled visual size, as a fraction of the top stage's value —
// keeps a tiny status (e.g. 1 lead vs. 16,558) visible as a real segment instead
// of collapsing to nothing, without ever changing the true count/percentage shown.
// Small because the log scale itself already keeps the tail from vanishing.
const VISUAL_FLOOR_RATIO = 0.04;

interface LeadsByStageChartProps {
  status: Record<string, WeekBucketCounts>;
  /** list_id-keyed counts (aggregates.list) — includes a "(none)" bucket for leads with
   * no list assigned. Optional: dashboards that don't fetch it just don't get the
   * "Stage" option. */
  list?: Record<string, number>;
  /** Access-filtered by the caller (canAccessList) — admin-only lists are simply absent
   * here, not rendered-then-hidden. */
  lists?: LeadList[];
  /** Status-view color lookup only (not a chart mode): a custom status whose slug/name
   * matches a pipeline stage reuses that stage's configured color instead of the
   * generic palette. Independent of `lists` above. */
  stages?: PipelineStage[];
}

type ChartMode = "status" | "list";

interface StatusDatum {
  name: string;
  value: number;
  status: string;
}

/** Cap an already-ordered list at MAX_STAGES, folding the remainder into a synthetic
 * "Other" bucket — same 3-8 "optimal funnel length" guidance as before, but generic
 * over both the status list (ordered by volume) and the pipeline list (ordered by
 * position), which must NOT be re-sorted here or the real funnel sequence breaks. */
function capToMaxStages<T extends { value: number }>(
  entries: T[],
  makeOther: (value: number) => T
): T[] {
  if (entries.length <= MAX_STAGES) return entries;
  return [
    ...entries.slice(0, MAX_STAGES - 1),
    makeOther(entries.slice(MAX_STAGES - 1).reduce((sum, d) => sum + d.value, 0)),
  ];
}

// Below 1%, "<1%" collapses every tail stage in a front-loaded funnel to the same
// label (55 leads and 2 leads both round to "<1%") — show two decimals instead so
// stages stay distinguishable. Below 0.01% falls back to "<0.01%" rather than "0.00%".
function formatPct(pct: number): string {
  if (pct === 0) return "0%";
  if (pct >= 99.95) return "100%";
  if (pct < 1) {
    if (pct < 0.01) return "<0.01%";
    return `${pct.toFixed(2)}%`;
  }
  return `${pct.toFixed(1).replace(/\.0$/, "")}%`;
}

function formatPercentage(value: number, base: number): string {
  if (base <= 0) return "0%";
  return formatPct((value / base) * 100);
}

export function LeadsByStageChart({ status, list, lists, stages }: LeadsByStageChartProps) {
  const [mode, setMode] = useState<ChartMode>("status");
  const listAvailable = !!list && !!lists && lists.length > 0;

  // Group leads by status (pre-aggregated — see migration 194's `status` dimension).
  // Volume-sorted: `status` is free text with no inherent order (see leads.status'
  // dropped CHECK constraint, migration 002), so "biggest bucket first" is the only
  // sequence available.
  const statusCounts: Record<string, number> = {};
  for (const [key, bucket] of Object.entries(status)) {
    if (bucket.all > 0) statusCounts[key] = bucket.all;
  }
  const statusSorted = Object.entries(statusCounts)
    .map(([key, count]) => ({
      name: key.charAt(0).toUpperCase() + key.slice(1),
      value: count,
      status: key,
    }))
    .sort((a, b) => b.value - a.value);
  const statusData: StatusDatum[] = capToMaxStages(statusSorted, (value) => ({
    name: "Other",
    status: OTHER_KEY,
    value,
  }));

  // Group leads by lead_lists.sort_order — the tenant's actual configured "Stage" order
  // (lead_lists is the table the UI calls "Stage", renamed from "List" 2026-07-05), not
  // a volume guess. Stages with 0 leads still render (a real, empty stage is meaningful
  // funnel information), so long as the tenant has any stages at all.
  const listSorted: StatusDatum[] = listAvailable
    ? [...lists]
        .sort((a, b) => a.sort_order - b.sort_order)
        .map((l) => ({
          name: l.name,
          value: list?.[l.id] ?? 0,
          status: l.id,
        }))
    : [];
  const listData: StatusDatum[] = capToMaxStages(listSorted, (value) => ({
    name: "Other",
    status: OTHER_KEY,
    value,
  }));

  const activeMode: ChartMode = mode === "list" && listAvailable ? "list" : "status";
  const data = activeMode === "list" ? listData : statusData;

  const getColor = (key: string, index: number): string => {
    if (key === OTHER_KEY) return OTHER_COLOR;
    if (activeMode === "list") {
      // Stage mode: use the tenant's own configured list color — never invent a new
      // palette for this dimension, it's the same color a user already sees on the
      // Leads page's stage dropdown itself.
      const l = lists?.find((l) => l.id === key);
      return l?.color || CHART_COLORS[index % CHART_COLORS.length];
    }
    if (STATUS_COLORS[key]) return STATUS_COLORS[key];
    if (stages) {
      const s = stages.find((s) => s.slug === key || s.name.toLowerCase() === key);
      if (s?.color) return s.color;
    }
    return CHART_COLORS[index % CHART_COLORS.length];
  };

  const title = activeMode === "list" ? "Leads by Stage" : "Leads by Status";

  const header = (
    <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0">
      <CardTitle className="text-sm font-medium uppercase tracking-wide text-muted-foreground">
        {title}
      </CardTitle>
      {listAvailable && (
        <Select value={activeMode} onValueChange={(v) => setMode(v as ChartMode)}>
          <SelectTrigger size="sm" className="w-auto gap-1.5 px-2.5 text-xs font-medium bg-[var(--sidebar-bg)] border-0">
            <SelectValue />
          </SelectTrigger>
          <SelectContent className="bg-[var(--sidebar-bg)] border-0 shadow-lg" align="start">
            <SelectItem value="status">Status</SelectItem>
            <SelectItem value="list">Stage</SelectItem>
          </SelectContent>
        </Select>
      )}
    </CardHeader>
  );

  if (data.length === 0) {
    return (
      <Card className="border-0 shadow-sm">
        {header}
        <CardContent className="flex items-center justify-center h-[250px]">
          <p className="text-muted-foreground">No leads data available</p>
        </CardContent>
      </Card>
    );
  }

  const topValue = data[0].value;
  const maxValue = Math.max(...data.map((d) => d.value), 1);
  // Log scale (not sqrt) so a heavily front-loaded funnel (one dominant stage, a long
  // near-zero tail) still tapers stage-to-stage instead of the tail clamping to one flat
  // floor size. A tiny floor stays only as a safety net for a stage worth ~0 of the top.
  const visualValue = (value: number) => {
    const ratio = Math.log1p(value) / Math.log1p(maxValue);
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
    id: entry.status,
    label: entry.name,
    value: entry.value,
    visualValue: visualValue(entry.value),
    displayValue: entry.value.toLocaleString(),
    color: getColor(entry.status, index),
  }));

  return (
    <Card className="border border-sidebar-border shadow-sm">
      {header}
      <CardContent className="bg-white">
        <div className="rounded-lg bg-sidebar-bg p-6">
          <FunnelChart
            data={funnelData}
            orientation="horizontal"
            layers={3}
            edges="curved"
            grid={{ lineColor: "var(--border)", bands: false }}
            formatPercentage={formatPct}
            formatValue={(v) => v.toLocaleString()}
          />
        </div>

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
