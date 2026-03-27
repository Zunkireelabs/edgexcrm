"use client";

import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip } from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { Lead, PipelineStage } from "@/types/database";

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

interface LeadsByStageChartProps {
  leads: Lead[];
  stages?: PipelineStage[];
}

export function LeadsByStageChart({ leads, stages }: LeadsByStageChartProps) {
  // Group leads by status
  const statusCounts = leads.reduce((acc, lead) => {
    const status = lead.status || "unknown";
    acc[status] = (acc[status] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);

  // Convert to chart data
  const data = Object.entries(statusCounts)
    .map(([status, count]) => ({
      name: status.charAt(0).toUpperCase() + status.slice(1),
      value: count,
      status,
    }))
    .sort((a, b) => b.value - a.value);

  const getColor = (status: string, index: number): string => {
    // Check if it's a known status
    if (STATUS_COLORS[status]) {
      return STATUS_COLORS[status];
    }
    // Check if we have stage colors
    if (stages) {
      const stage = stages.find((s) => s.slug === status || s.name.toLowerCase() === status);
      if (stage?.color) return stage.color;
    }
    // Fallback to chart colors
    return CHART_COLORS[index % CHART_COLORS.length];
  };

  const total = leads.length;

  if (data.length === 0) {
    return (
      <Card>
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

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm font-medium uppercase tracking-wide text-muted-foreground">
          Leads by Status
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="flex items-center gap-6">
          {/* Donut Chart */}
          <div className="h-[200px] w-[200px] flex-shrink-0">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={data}
                  cx="50%"
                  cy="50%"
                  innerRadius={50}
                  outerRadius={80}
                  paddingAngle={2}
                  dataKey="value"
                >
                  {data.map((entry, index) => (
                    <Cell
                      key={`cell-${index}`}
                      fill={getColor(entry.status, index)}
                      stroke="white"
                      strokeWidth={2}
                    />
                  ))}
                </Pie>
                <Tooltip
                  content={({ active, payload }) => {
                    if (active && payload && payload.length) {
                      const data = payload[0].payload;
                      const percentage = ((data.value / total) * 100).toFixed(1);
                      return (
                        <div className="rounded-lg border border-border bg-background px-3 py-2">
                          <p className="font-medium">{data.name}</p>
                          <p className="text-sm text-muted-foreground">
                            {data.value} leads ({percentage}%)
                          </p>
                        </div>
                      );
                    }
                    return null;
                  }}
                />
              </PieChart>
            </ResponsiveContainer>
          </div>

          {/* Legend */}
          <div className="flex flex-col gap-2 flex-1">
            {data.map((entry, index) => {
              const percentage = ((entry.value / total) * 100).toFixed(0);
              return (
                <div key={entry.status} className="flex items-center gap-2">
                  <div
                    className="h-3 w-3 rounded-sm flex-shrink-0"
                    style={{ backgroundColor: getColor(entry.status, index) }}
                  />
                  <span className="text-sm font-medium">{entry.value}</span>
                  <span className="text-sm text-muted-foreground">{entry.name}</span>
                  <span className="text-xs text-muted-foreground ml-auto">
                    {percentage}%
                  </span>
                </div>
              );
            })}
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
