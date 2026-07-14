"use client";

import type { ReactNode } from "react";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";
import type { ValueType } from "recharts/types/component/DefaultTooltipContent";
import { useWidgetData } from "@/industries/_shared/features/insights/lib/use-widget-data";
import { WidgetCard, WidgetLoading, WidgetEmpty, WidgetError } from "./widget-shell";

interface WeekPoint {
  week: string;
  count: number;
}

export default function SalesLeadsTrendWidget() {
  const { data, loading, error } = useWidgetData<WeekPoint[]>("/api/v1/insights/sales/leads-trend");

  return (
    <WidgetCard title="New Leads Over Time">
      {loading ? (
        <WidgetLoading />
      ) : error ? (
        <WidgetError message="Failed to load the leads trend." />
      ) : !data || data.length === 0 || data.every((d) => d.count === 0) ? (
        <WidgetEmpty message="No new leads in the last 12 weeks." />
      ) : (
        <div className="h-[240px]">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} />
              <XAxis
                dataKey="week"
                tickFormatter={(v: string) => new Date(v).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                tick={{ fontSize: 11 }}
              />
              <YAxis allowDecimals={false} tick={{ fontSize: 11 }} width={30} />
              <Tooltip
                labelFormatter={(v?: ReactNode) => `Week of ${new Date(String(v)).toLocaleDateString()}`}
                formatter={(value?: ValueType) => [Number(value ?? 0), "New leads"]}
              />
              <Bar dataKey="count" fill="#3b82f6" radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </WidgetCard>
  );
}
