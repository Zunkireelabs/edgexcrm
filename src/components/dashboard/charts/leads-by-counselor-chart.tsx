"use client";

import { BarChart, Bar, XAxis, YAxis, ResponsiveContainer, Tooltip, Cell } from "recharts";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { Lead } from "@/types/database";

// Chart colors
const CHART_COLORS = [
  "#3B82F6", // Blue
  "#22C55E", // Green
  "#F59E0B", // Amber
  "#8B5CF6", // Purple
  "#EC4899", // Pink
  "#06B6D4", // Cyan
];

interface LeadsByCounselorChartProps {
  leads: Lead[];
  memberMap: Record<string, string>; // user_id -> email
}

export function LeadsByCounselorChart({ leads, memberMap }: LeadsByCounselorChartProps) {
  // Group leads by assigned counselor
  const counselorCounts = leads.reduce((acc, lead) => {
    const assignedTo = lead.assigned_to;
    const counselorName = assignedTo
      ? memberMap[assignedTo]?.split("@")[0] || "Unknown"
      : "Unassigned";
    acc[counselorName] = (acc[counselorName] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);

  // Convert to chart data and sort by count
  const data = Object.entries(counselorCounts)
    .map(([name, count]) => ({
      name: name.charAt(0).toUpperCase() + name.slice(1),
      count,
    }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 6); // Top 6 counselors

  if (data.length === 0) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-sm font-medium uppercase tracking-wide text-muted-foreground">
            Leads by Counselor
          </CardTitle>
        </CardHeader>
        <CardContent className="flex items-center justify-center h-[250px]">
          <p className="text-muted-foreground">No assignment data available</p>
        </CardContent>
      </Card>
    );
  }

  const maxCount = Math.max(...data.map((d) => d.count));

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-sm font-medium uppercase tracking-wide text-muted-foreground">
          Leads by Counselor
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div className="space-y-3">
          {data.map((entry, index) => {
            const percentage = (entry.count / maxCount) * 100;
            return (
              <div key={entry.name} className="space-y-1">
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">{entry.name}</span>
                  <span className="font-medium">{entry.count}</span>
                </div>
                <div className="h-2 w-full bg-muted rounded-full overflow-hidden">
                  <div
                    className="h-full rounded-full transition-all duration-500"
                    style={{
                      width: `${percentage}%`,
                      backgroundColor: CHART_COLORS[index % CHART_COLORS.length],
                    }}
                  />
                </div>
              </div>
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}
