"use client";

import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Cell } from "recharts";
import type { ValueType } from "recharts/types/component/DefaultTooltipContent";
import { useWidgetData } from "@/industries/_shared/features/insights/lib/use-widget-data";
import { WidgetCard, WidgetLoading, WidgetEmpty, WidgetError } from "./widget-shell";

interface AgingBucket {
  bucket: string;
  count: number;
}

const BUCKET_LABELS: Record<string, string> = {
  "0-7": "0-7 days",
  "8-14": "8-14 days",
  "15-30": "15-30 days",
  "30+": "30+ days",
};

const BUCKET_COLORS: Record<string, string> = {
  "0-7": "#16a34a",
  "8-14": "#d97706",
  "15-30": "#f97316",
  "30+": "#dc2626",
};

export default function SalesAgingWidget() {
  const { data, loading, error } = useWidgetData<AgingBucket[]>("/api/v1/insights/sales/aging");

  const total = data?.reduce((sum, r) => sum + r.count, 0) ?? 0;
  const chartData = data?.map((d) => ({ ...d, label: BUCKET_LABELS[d.bucket] ?? d.bucket })) ?? [];

  return (
    <WidgetCard title="Aging / Stale Leads">
      {loading ? (
        <WidgetLoading />
      ) : error ? (
        <WidgetError message="Failed to load aging leads." />
      ) : !data || total === 0 ? (
        <WidgetEmpty message="No open leads to age." />
      ) : (
        <div className="h-[200px]">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={chartData} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} />
              <XAxis dataKey="label" tick={{ fontSize: 11 }} />
              <YAxis allowDecimals={false} tick={{ fontSize: 11 }} width={30} />
              <Tooltip formatter={(value?: ValueType) => [Number(value ?? 0), "Leads"]} />
              <Bar dataKey="count" radius={[4, 4, 0, 0]}>
                {chartData.map((entry) => (
                  <Cell key={entry.bucket} fill={BUCKET_COLORS[entry.bucket] ?? "#94a3b8"} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>
      )}
    </WidgetCard>
  );
}
