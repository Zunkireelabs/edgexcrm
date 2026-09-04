"use client";

import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

// Chart colors
const CHART_COLORS = [
  "#3B82F6", // Blue
  "#22C55E", // Green
  "#F59E0B", // Amber
  "#8B5CF6", // Purple
  "#EC4899", // Pink
  "#06B6D4", // Cyan
];

interface LeadsBySourceChartProps {
  sourceCounts: Record<string, number>; // resolved source name -> count (see resolveSourceCounts)
}

export function LeadsBySourceChart({ sourceCounts }: LeadsBySourceChartProps) {
  // Convert to chart data and sort by count
  const data = Object.entries(sourceCounts)
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 6); // Top 6 sources

  if (data.length === 0) {
    return (
      <Card className="h-full self-stretch flex flex-col border border-sidebar-border shadow-sm">
        <CardHeader>
          <CardTitle className="text-sm font-medium uppercase tracking-wide text-muted-foreground">
            Leads by Source
          </CardTitle>
        </CardHeader>
        <CardContent className="flex flex-1 items-center justify-center">
          <p className="text-muted-foreground">No source data available</p>
        </CardContent>
      </Card>
    );
  }

  const total = data.reduce((sum, d) => sum + d.count, 0);
  const topSource = data[0];
  const topPercentage = total > 0 ? ((topSource.count / total) * 100).toFixed(1) : "0";

  return (
    <Card className="h-full self-stretch flex flex-col border border-sidebar-border shadow-sm">
      <CardHeader>
        <CardTitle className="text-sm font-medium uppercase tracking-wide text-muted-foreground">
          Leads by Source
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
                  nameKey="name"
                  stroke="none"
                >
                  {data.map((entry, index) => (
                    <Cell key={entry.name} fill={CHART_COLORS[index % CHART_COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip
                  allowEscapeViewBox={{ x: true, y: true }}
                  wrapperStyle={{ zIndex: 50 }}
                  content={({ active, payload }) => {
                    if (active && payload && payload.length) {
                      const d = payload[0].payload as { name: string; count: number };
                      const pct = total > 0 ? ((d.count / total) * 100).toFixed(1) : "0";
                      return (
                        <div className="rounded-lg border border-border bg-background px-3 py-2 shadow-sm">
                          <p className="text-sm font-medium">{d.name}</p>
                          <p className="text-xs text-muted-foreground">
                            {d.count} ({pct}%)
                          </p>
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
              <span className="text-[11px] text-muted-foreground">Top source</span>
              <span className="max-w-[90px] truncate text-[11px] font-medium text-foreground" title={topSource.name}>
                {topSource.name}
              </span>
            </div>
          </div>

          <div className="mt-3 flex flex-col gap-2.5">
            {data.map((entry, index) => {
              return (
                <div key={entry.name} className="flex items-center gap-2 text-sm">
                  <span
                    className="h-2.5 w-2.5 flex-shrink-0 rounded-full"
                    style={{ backgroundColor: CHART_COLORS[index % CHART_COLORS.length] }}
                  />
                  <span className="truncate text-muted-foreground" title={entry.name}>
                    {entry.name}
                  </span>
                  <span className="ml-auto flex-shrink-0 font-medium">{entry.count}</span>
                </div>
              );
            })}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
