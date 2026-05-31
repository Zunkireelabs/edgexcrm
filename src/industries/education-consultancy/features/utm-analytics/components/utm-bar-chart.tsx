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
}

function truncate(name: string): string {
  return name.length > 20 ? `${name.slice(0, 20)}…` : name;
}

export function UtmBarChart({ title, emptyMessage, field, leads }: UtmBarChartProps) {
  const buckets = groupByUtmField(leads, field);

  const data = buckets.map((b) => ({
    name: truncate(b.name),
    fullName: b.name,
    count: b.count,
  }));

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
        <div className="h-[220px] w-full">
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
                content={({ active, payload }) => {
                  if (active && payload && payload.length) {
                    const p = payload[0].payload as { fullName: string; count: number };
                    return (
                      <div className="rounded-lg border border-border bg-background px-3 py-2">
                        <p className="font-medium">{p.fullName}</p>
                        <p className="text-sm text-muted-foreground">{p.count} leads</p>
                      </div>
                    );
                  }
                  return null;
                }}
              />
              <Bar dataKey="count" radius={[0, 4, 4, 0]} maxBarSize={30}>
                {data.map((_, index) => (
                  <Cell
                    key={`cell-${index}`}
                    fill={CHART_COLORS[index % CHART_COLORS.length]}
                  />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>

        <div className="mt-4 grid grid-cols-2 gap-2">
          {data.map((entry, index) => (
            <div key={entry.fullName} className="flex items-center gap-2 text-sm">
              <div
                className="h-2.5 w-2.5 rounded-sm flex-shrink-0"
                style={{ backgroundColor: CHART_COLORS[index % CHART_COLORS.length] }}
              />
              <span className="truncate text-muted-foreground" title={entry.fullName}>
                {entry.name}
              </span>
              <span className="font-medium ml-auto">{entry.count}</span>
            </div>
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
