"use client";

import { UserX } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

interface LeadsByCounselorChartProps {
  /** assigned_to-keyed counts ("(unassigned)" sentinel) — see migration 194's `counselor` dimension. */
  assignedToCounts: Record<string, number>;
  memberMap: Record<string, string>; // user_id -> email
  memberNames?: Record<string, string>; // user_id -> display name
}

const BAR_COLORS = [
  "#3B82F6", // Blue
  "#22C55E", // Green
  "#F59E0B", // Amber
  "#8B5CF6", // Purple
  "#EC4899", // Pink
  "#06B6D4", // Cyan
];

const UNASSIGNED_KEY = "(unassigned)";

/** D3-style "nice numbers" tick generator — picks round tick spacing (1/2/5 * 10^n)
 * so the axis reads 0, 200, 400... instead of raw fractions of the max bar value. */
function niceNum(range: number, round: boolean): number {
  if (range <= 0) return 1;
  const exponent = Math.floor(Math.log10(range));
  const fraction = range / Math.pow(10, exponent);
  let niceFraction: number;
  if (round) {
    if (fraction < 1.5) niceFraction = 1;
    else if (fraction < 3) niceFraction = 2;
    else if (fraction < 7) niceFraction = 5;
    else niceFraction = 10;
  } else {
    if (fraction <= 1) niceFraction = 1;
    else if (fraction <= 2) niceFraction = 2;
    else if (fraction <= 5) niceFraction = 5;
    else niceFraction = 10;
  }
  return niceFraction * Math.pow(10, exponent);
}

function niceTicks(max: number, tickCount = 4): number[] {
  if (max <= 0) return [0, 1];
  const niceRange = niceNum(max, false);
  const tickSpacing = niceNum(niceRange / tickCount, true);
  const niceMax = Math.ceil(max / tickSpacing) * tickSpacing;
  const ticks: number[] = [];
  for (let t = 0; t <= niceMax + tickSpacing * 0.5; t += tickSpacing) ticks.push(t);
  return ticks;
}

export function LeadsByCounselorChart({ assignedToCounts, memberMap, memberNames = {} }: LeadsByCounselorChartProps) {
  const counselorCounts: Record<string, number> = {};
  for (const [assignedTo, count] of Object.entries(assignedToCounts)) {
    const counselorName =
      assignedTo !== UNASSIGNED_KEY
        ? memberNames[assignedTo] || memberMap[assignedTo]?.split("@")[0] || "Unknown"
        : "Unassigned";
    counselorCounts[counselorName] = (counselorCounts[counselorName] || 0) + count;
  }

  const unassignedCount = counselorCounts["Unassigned"] || 0;
  const assignedData = Object.entries(counselorCounts)
    .filter(([name]) => name !== "Unassigned")
    .map(([name, count]) => ({
      name: name.charAt(0).toUpperCase() + name.slice(1),
      count,
    }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 6);

  const totalAssigned = assignedData.reduce((sum, d) => sum + d.count, 0);
  const totalLeads = unassignedCount + totalAssigned;

  if (totalLeads === 0) {
    return (
      <Card className="border border-sidebar-border shadow-sm">
        <CardHeader>
          <CardTitle className="text-sm font-medium uppercase tracking-wide text-muted-foreground">
            Leads by Team Member
          </CardTitle>
        </CardHeader>
        <CardContent className="flex items-center justify-center h-[250px]">
          <p className="text-muted-foreground">No assignment data available</p>
        </CardContent>
      </Card>
    );
  }

  const unassignedPct = totalLeads > 0 ? ((unassignedCount / totalLeads) * 100).toFixed(1) : "0";
  const maxCount = Math.max(...assignedData.map((d) => d.count), 0);
  const ticks = niceTicks(maxCount);
  const axisMax = ticks[ticks.length - 1];

  return (
    <Card className="border border-sidebar-border shadow-sm bg-white">
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium uppercase tracking-wide text-muted-foreground">
          Leads by Team Member
        </CardTitle>
      </CardHeader>
      <CardContent className="pt-0">
        <div className="rounded-lg bg-sidebar-bg p-5">
          {/* Unassigned leads — highlighted summary */}
          <div className="flex items-center gap-3 rounded-lg bg-red-50 px-4 py-3">
            <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full bg-red-100">
              <UserX className="h-4 w-4 text-red-500" />
            </div>
            <div className="flex flex-col">
              <span className="text-xl font-bold leading-tight text-red-600">
                {unassignedCount.toLocaleString()}
              </span>
              <span className="text-xs text-muted-foreground">Unassigned Leads</span>
            </div>
            <div className="ml-2 h-7 w-px flex-shrink-0 bg-red-200" />
            <span className="flex-shrink-0 rounded-full bg-red-100 px-2.5 py-1 text-xs font-semibold text-red-600">
              {unassignedPct}% of total leads
            </span>
          </div>

          {/* Assigned leads */}
          {assignedData.length > 0 && (
            <>
              <p className="mb-2.5 mt-4 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                Assigned Leads
              </p>
              <div className="flex flex-col gap-2.5">
                {assignedData.map((entry, index) => {
                  const color = BAR_COLORS[index % BAR_COLORS.length];
                  const pct = totalAssigned > 0 ? ((entry.count / totalAssigned) * 100).toFixed(1) : "0";
                  const widthPct = axisMax > 0 ? (entry.count / axisMax) * 100 : 0;
                  const initial = entry.name.charAt(0).toUpperCase();
                  return (
                    <div key={entry.name} className="flex items-center gap-3">
                      <div
                        className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full text-[11px] font-semibold"
                        style={{ backgroundColor: `${color}26`, color }}
                      >
                        {initial}
                      </div>
                      <span className="w-24 flex-shrink-0 truncate text-sm text-foreground" title={entry.name}>
                        {entry.name}
                      </span>
                      <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-border">
                        <div
                          className="h-full rounded-full"
                          style={{ width: `${Math.min(widthPct, 100)}%`, backgroundColor: color }}
                        />
                      </div>
                      <div className="flex w-16 flex-shrink-0 items-baseline justify-end gap-1.5">
                        <span className="text-sm font-semibold text-foreground">{entry.count.toLocaleString()}</span>
                        <span className="text-[11px] font-medium" style={{ color }}>
                          {pct}%
                        </span>
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Subtle Leads axis */}
              <div className="mt-2 flex items-center pl-9">
                <div className="flex flex-1 justify-between text-[10px] text-muted-foreground">
                  {ticks.map((tick) => (
                    <span key={tick}>{tick.toLocaleString()}</span>
                  ))}
                </div>
                <span className="w-16 flex-shrink-0 text-right text-[10px] text-muted-foreground">Leads</span>
              </div>
            </>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
