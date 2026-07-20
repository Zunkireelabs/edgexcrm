"use client";

import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip } from "recharts";
import { useWidgetData } from "@/industries/_shared/features/insights/lib/use-widget-data";
import type { Project } from "@/types/database";
import { WidgetCard, WidgetLoading, WidgetEmpty, WidgetError } from "./widget-shell";

const STATUS_LABELS: Record<string, string> = {
  planning: "Planning",
  active: "Active",
  in_review: "In Review",
  delivered: "Delivered",
  on_hold: "On Hold",
  cancelled: "Cancelled",
};

const STATUS_COLORS: Record<string, string> = {
  planning: "#8B5CF6",
  active: "#16a34a",
  in_review: "#d97706",
  delivered: "#3B82F6",
  on_hold: "#F59E0B",
  cancelled: "#dc2626",
};

export default function ProjectsByStatusWidget() {
  const { data: projects, loading, error } = useWidgetData<Project[]>("/api/v1/projects");

  return (
    <WidgetCard title="Projects by Status">
      {loading ? (
        <WidgetLoading />
      ) : error ? (
        <WidgetError message="Failed to load projects." />
      ) : !projects || projects.length === 0 ? (
        <WidgetEmpty message="No projects yet." />
      ) : (
        <ProjectsByStatusContent projects={projects} />
      )}
    </WidgetCard>
  );
}

function ProjectsByStatusContent({ projects }: { projects: Project[] }) {
  const counts = new Map<string, number>();
  for (const p of projects) counts.set(p.status, (counts.get(p.status) ?? 0) + 1);

  const data = Array.from(counts.entries())
    .map(([status, value]) => ({ status, value, name: STATUS_LABELS[status] ?? status }))
    .sort((a, b) => b.value - a.value);

  const total = projects.length;

  return (
    <div className="flex items-center gap-6">
      <div className="h-[180px] w-[180px] flex-shrink-0">
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Pie data={data} cx="50%" cy="50%" innerRadius={45} outerRadius={75} paddingAngle={2} dataKey="value">
              {data.map((entry) => (
                <Cell key={entry.status} fill={STATUS_COLORS[entry.status] ?? "#94a3b8"} stroke="white" strokeWidth={2} />
              ))}
            </Pie>
            <Tooltip
              content={({ active, payload }) => {
                if (active && payload && payload.length) {
                  const d = payload[0].payload as { name: string; value: number };
                  const pct = ((d.value / total) * 100).toFixed(1);
                  return (
                    <div className="rounded-lg border border-border bg-background px-3 py-2">
                      <p className="font-medium">{d.name}</p>
                      <p className="text-sm text-muted-foreground">{d.value} projects ({pct}%)</p>
                    </div>
                  );
                }
                return null;
              }}
            />
          </PieChart>
        </ResponsiveContainer>
      </div>
      <div className="flex flex-col gap-2 flex-1">
        {data.map((entry) => {
          const pct = ((entry.value / total) * 100).toFixed(0);
          return (
            <div key={entry.status} className="flex items-center gap-2">
              <div
                className="h-3 w-3 rounded-sm flex-shrink-0"
                style={{ backgroundColor: STATUS_COLORS[entry.status] ?? "#94a3b8" }}
              />
              <span className="text-sm font-medium">{entry.value}</span>
              <span className="text-sm text-muted-foreground">{entry.name}</span>
              <span className="text-xs text-muted-foreground ml-auto">{pct}%</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
