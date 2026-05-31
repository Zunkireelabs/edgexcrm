"use client";

import { BarChart, Bar, XAxis, YAxis, ResponsiveContainer, Tooltip, Cell } from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { Lead } from "@/types/database";
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
  leads: Lead[];
  selectedValue?: string | null;
  onSelect?: (value: string | null) => void;
}

function truncate(name: string): string {
  return name.length > 20 ? `${name.slice(0, 20)}…` : name;
}

export function UtmBarChart({
  title,
  emptyMessage,
  field,
  leads,
  selectedValue = null,
  onSelect,
}: UtmBarChartProps) {
  const buckets = groupByUtmField(leads, field);

  const data = buckets.map((b) => ({
    name: truncate(b.name),
    fullName: b.name,
    count: b.count,
  }));

  const isInteractive = Boolean(onSelect);

  function handleSelect(value: string) {
    if (!onSelect) return;
    onSelect(selectedValue === value ? null : value);
  }

  if (data.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-medium uppercase tracking-wide text-muted-foreground">
            {title}
          </CardTitle>
        </CardHeader>
        <CardContent className="flex items-center justify-center h-[250px]">
          <p className="text-muted-foreground text-sm">{emptyMessage}</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm font-medium uppercase tracking-wide text-muted-foreground">
          {title}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="h-[220px] w-full [&_.recharts-bar-rectangle]:outline-none [&_.recharts-bar-rectangle_path]:outline-none [&_.recharts-rectangle]:outline-none [&_path]:focus:outline-none">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart
              data={data}
              layout="vertical"
              margin={{ top: 0, right: 30, left: 0, bottom: 0 }}
            >
              <XAxis type="number" hide />
              <YAxis
                type="category"
                dataKey="name"
                axisLine={false}
                tickLine={false}
                tick={{ fontSize: 12, fill: "#6b7280" }}
                width={120}
              />
              <Tooltip
                cursor={false}
                content={({ active, payload }) => {
                  if (active && payload && payload.length) {
                    const p = payload[0].payload as { fullName: string; count: number };
                    return (
                      <div className="rounded-lg border border-border bg-background px-3 py-2">
                        <p className="font-medium">{p.fullName}</p>
                        <p className="text-sm text-muted-foreground">{p.count} leads</p>
                        {isInteractive && (
                          <p className="text-xs text-muted-foreground mt-1">
                            {selectedValue === p.fullName ? "Click to clear" : "Click to filter"}
                          </p>
                        )}
                      </div>
                    );
                  }
                  return null;
                }}
              />
              <Bar
                dataKey="count"
                radius={[0, 4, 4, 0]}
                maxBarSize={30}
                activeBar={false}
                isAnimationActive={false}
                onClick={(payload) => {
                  const p = payload as unknown as { fullName?: string };
                  if (p?.fullName) handleSelect(p.fullName);
                }}
                style={isInteractive ? { cursor: "pointer" } : undefined}
              >
                {data.map((entry, index) => {
                  const isSelected = selectedValue === entry.fullName;
                  const isDimmed = selectedValue !== null && !isSelected;
                  return (
                    <Cell
                      key={`cell-${index}`}
                      fill={CHART_COLORS[index % CHART_COLORS.length]}
                      fillOpacity={isDimmed ? 0.3 : 1}
                    />
                  );
                })}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>

        <div className="mt-4 grid grid-cols-2 gap-2">
          {data.map((entry, index) => {
            const isSelected = selectedValue === entry.fullName;
            const isDimmed = selectedValue !== null && !isSelected;
            return (
              <button
                key={entry.fullName}
                type="button"
                onClick={() => handleSelect(entry.fullName)}
                disabled={!isInteractive}
                className={`flex items-center gap-2 text-sm rounded-md px-1 py-0.5 -mx-1 text-left transition-opacity ${
                  isInteractive ? "hover:bg-muted cursor-pointer" : "cursor-default"
                } ${isDimmed ? "opacity-50" : ""}`}
              >
                <div
                  className="h-2.5 w-2.5 rounded-sm flex-shrink-0"
                  style={{ backgroundColor: CHART_COLORS[index % CHART_COLORS.length] }}
                />
                <span
                  className={`truncate ${isSelected ? "font-semibold text-foreground" : "text-muted-foreground"}`}
                  title={entry.fullName}
                >
                  {entry.name}
                </span>
                <span className="font-medium ml-auto">{entry.count}</span>
              </button>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}
