"use client";

import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Tooltip as UiTooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import type { LeadUtmRow } from "@/lib/supabase/queries";
import { groupByUtmField, type UtmField } from "../lib/aggregation";

const CHART_COLORS = [
  "#3B82F6",
  "#22C55E",
  "#F59E0B",
  "#8B5CF6",
  "#EC4899",
  "#06B6D4",
  "#F97316",
  "#14B8A6",
  "#A1A1AA",
];

interface UtmBarChartProps {
  title: string;
  emptyMessage: string;
  field: UtmField;
  leads: LeadUtmRow[];
  selectedValue?: string | null;
  onSelect?: (value: string | null) => void;
}

function truncate(name: string): string {
  return name.length > 20 ? `${name.slice(0, 20)}…` : name;
}

const MAX_LEGEND_ROWS = 6;

export function UtmBarChart({
  title,
  emptyMessage,
  field,
  leads,
  selectedValue = null,
  onSelect,
}: UtmBarChartProps) {
  const buckets = groupByUtmField(leads, field);

  const displayBuckets =
    buckets.length > MAX_LEGEND_ROWS
      ? (() => {
          const head = buckets.slice(0, MAX_LEGEND_ROWS - 1);
          const tail = buckets.slice(MAX_LEGEND_ROWS - 1);
          const otherCount = tail.reduce((sum, b) => sum + b.count, 0);
          const otherNames = tail.flatMap((b) => b.otherNames ?? [b.name]);
          return [...head, { name: "Other", count: otherCount, otherNames }];
        })()
      : buckets;

  const data = displayBuckets.map((b) => ({
    name: truncate(b.name),
    fullName: b.name,
    count: b.count,
    otherNames: b.otherNames,
  }));

  const isInteractive = Boolean(onSelect);

  function handleSelect(value: string) {
    if (!onSelect) return;
    onSelect(selectedValue === value ? null : value);
  }

  if (data.length === 0) {
    return (
      <Card className="h-full self-stretch flex flex-col border border-sidebar-border shadow-sm">
        <CardHeader>
          <CardTitle className="text-sm font-medium uppercase tracking-wide text-muted-foreground">
            {title}
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-1 flex-col">
          <div className="flex flex-1 flex-col items-center justify-center rounded-lg bg-sidebar-bg p-6">
            <p className="text-muted-foreground text-sm">{emptyMessage}</p>
          </div>
        </CardContent>
      </Card>
    );
  }

  const total = data.reduce((sum, d) => sum + d.count, 0);
  const topEntry = data[0];
  const topPercentage = total > 0 ? ((topEntry.count / total) * 100).toFixed(1) : "0";

  return (
    <Card className="h-full self-stretch flex flex-col border border-sidebar-border shadow-sm">
      <CardHeader>
        <CardTitle className="text-sm font-medium uppercase tracking-wide text-muted-foreground">
          {title}
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-1 flex-col">
        <div className="flex flex-1 flex-col rounded-lg bg-sidebar-bg p-6">
          <div className="relative mx-auto h-[160px] w-[160px]">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={data}
                  cx="50%"
                  cy="50%"
                  innerRadius={58}
                  outerRadius={72}
                  cornerRadius={6}
                  paddingAngle={4}
                  dataKey="count"
                  nameKey="fullName"
                  stroke="none"
                  isAnimationActive={false}
                  onClick={(entry) => {
                    const p = entry as unknown as { fullName?: string; otherNames?: string[] };
                    if (p?.fullName && !p.otherNames) handleSelect(p.fullName);
                  }}
                  style={isInteractive ? { cursor: "pointer" } : undefined}
                >
                  {data.map((entry, index) => {
                    const isSelected = selectedValue === entry.fullName;
                    const isDimmed = selectedValue !== null && !isSelected;
                    return (
                      <Cell
                        key={entry.fullName}
                        fill={CHART_COLORS[index % CHART_COLORS.length]}
                        fillOpacity={isDimmed ? 0.3 : 1}
                      />
                    );
                  })}
                </Pie>
                <Tooltip
                  allowEscapeViewBox={{ x: true, y: true }}
                  wrapperStyle={{ zIndex: 50 }}
                  content={({ active, payload }) => {
                    if (active && payload && payload.length) {
                      const d = payload[0].payload as {
                        fullName: string;
                        count: number;
                        otherNames?: string[];
                      };
                      const pct = total > 0 ? ((d.count / total) * 100).toFixed(1) : "0";
                      const OTHER_PREVIEW = 6;
                      return (
                        <div className="max-w-[240px] rounded-lg border border-border bg-background px-3 py-2 shadow-sm">
                          <p className="text-sm font-medium">{d.fullName}</p>
                          <p className="text-xs text-muted-foreground">
                            {d.count} ({pct}%)
                          </p>
                          {d.otherNames ? (
                            <div className="mt-1.5 border-t border-border pt-1.5">
                              <p className="text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
                                Includes
                              </p>
                              <ul className="mt-1 space-y-0.5">
                                {d.otherNames.slice(0, OTHER_PREVIEW).map((name) => (
                                  <li key={name} className="truncate text-xs text-foreground" title={name}>
                                    {name}
                                  </li>
                                ))}
                              </ul>
                              {d.otherNames.length > OTHER_PREVIEW && (
                                <p className="mt-0.5 text-xs text-muted-foreground">
                                  +{d.otherNames.length - OTHER_PREVIEW} more
                                </p>
                              )}
                            </div>
                          ) : (
                            isInteractive && (
                              <p className="text-xs text-muted-foreground mt-1">
                                {selectedValue === d.fullName ? "Click to clear" : "Click to filter"}
                              </p>
                            )
                          )}
                        </div>
                      );
                    }
                    return null;
                  }}
                />
              </PieChart>
            </ResponsiveContainer>
            <div className="pointer-events-none absolute left-1/2 top-1/2 h-[116px] w-[116px] -translate-x-1/2 -translate-y-1/2 rounded-full border border-border" />
            <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
              <span className="text-xl font-bold text-foreground">{topPercentage}%</span>
              <span className="text-[11px] text-muted-foreground">Top {title.replace(/^By /, "").toLowerCase()}</span>
              <span className="max-w-[90px] truncate text-[11px] font-medium text-foreground" title={topEntry.fullName}>
                {topEntry.fullName}
              </span>
            </div>
          </div>

          <TooltipProvider delayDuration={150}>
            <div className="mt-3 flex flex-col gap-2.5">
              {data.map((entry, index) => {
                const isSelected = selectedValue === entry.fullName;
                const isDimmed = selectedValue !== null && !isSelected;
                const isOther = Boolean(entry.otherNames);
                const clickable = isInteractive && !isOther;

                const row = (
                  <button
                    key={entry.fullName}
                    type="button"
                    onClick={() => !isOther && handleSelect(entry.fullName)}
                    disabled={!clickable}
                    className={`flex items-center gap-2 text-sm rounded-md px-1 py-0.5 -mx-1 text-left transition-opacity ${
                      clickable ? "hover:bg-muted cursor-pointer" : "cursor-default"
                    } ${isDimmed ? "opacity-50" : ""}`}
                  >
                    <span
                      className="h-2.5 w-2.5 flex-shrink-0 rounded-full"
                      style={{ backgroundColor: CHART_COLORS[index % CHART_COLORS.length] }}
                    />
                    <span
                      className={`truncate ${isSelected ? "font-semibold text-foreground" : "text-muted-foreground"}`}
                      title={isOther ? undefined : entry.fullName}
                    >
                      {entry.name}
                    </span>
                    <span className="ml-auto flex-shrink-0 font-medium">{entry.count}</span>
                  </button>
                );

                if (!isOther) return row;

                return (
                  <UiTooltip key={entry.fullName}>
                    <TooltipTrigger asChild>{row}</TooltipTrigger>
                    <TooltipContent side="top" className="max-w-[240px] p-0">
                      <div className="px-3 py-2 text-left">
                        <p className="text-[11px] font-medium uppercase tracking-wide text-background/70">
                          Includes
                        </p>
                        <ul className="mt-1 space-y-0.5">
                          {entry.otherNames!.slice(0, 6).map((name) => (
                            <li key={name} className="truncate" title={name}>
                              {name}
                            </li>
                          ))}
                        </ul>
                        {entry.otherNames!.length > 6 && (
                          <p className="mt-0.5 text-background/70">
                            +{entry.otherNames!.length - 6} more
                          </p>
                        )}
                      </div>
                    </TooltipContent>
                  </UiTooltip>
                );
              })}
            </div>
          </TooltipProvider>
        </div>
      </CardContent>
    </Card>
  );
}
