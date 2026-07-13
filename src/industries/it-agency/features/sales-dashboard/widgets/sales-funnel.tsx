"use client";

import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell } from "recharts";
import type { ValueType } from "recharts/types/component/DefaultTooltipContent";
import { useWidgetData } from "@/industries/_shared/features/insights/lib/use-widget-data";
import { WidgetCard, WidgetLoading, WidgetEmpty, WidgetError } from "./widget-shell";

interface StageRow {
  stage_id: string;
  name: string;
  sort_order: number;
  count: number;
}

const FUNNEL_COLORS = ["#3b82f6", "#6366f1", "#8b5cf6", "#d946ef", "#ec4899", "#f43f5e"];

export default function SalesFunnelWidget() {
  const { data, loading, error } = useWidgetData<StageRow[]>("/api/v1/insights/sales/funnel");

  const total = data?.reduce((sum, r) => sum + r.count, 0) ?? 0;

  return (
    <WidgetCard title="Pipeline by Stage">
      {loading ? (
        <WidgetLoading />
      ) : error ? (
        <WidgetError message="Failed to load pipeline by stage." />
      ) : !data || data.length === 0 ? (
        <WidgetEmpty message="No stages configured yet." />
      ) : total === 0 ? (
        <WidgetEmpty message="No leads in any stage yet." />
      ) : (
        <div className="h-[260px]">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={data} layout="vertical" margin={{ top: 8, right: 24, left: 8, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" horizontal={false} />
              <XAxis type="number" allowDecimals={false} tick={{ fontSize: 11 }} />
              <YAxis type="category" dataKey="name" tick={{ fontSize: 12 }} width={110} />
              <Tooltip formatter={(value?: ValueType) => [Number(value ?? 0), "Leads"]} />
              <Bar dataKey="count" radius={[0, 4, 4, 0]}>
                {data.map((entry, i) => (
                  <Cell key={entry.stage_id} fill={FUNNEL_COLORS[i % FUNNEL_COLORS.length]} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </WidgetCard>
  );
}
