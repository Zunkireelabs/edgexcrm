"use client";

import { useMemo, useState } from "react";
import type { Lead } from "@/types/database";
import { UtmBarChart } from "./utm-bar-chart";
import {
  UTM_DATE_FILTER_OPTIONS,
  getUtmDateCutoff,
  type UtmDateFilter,
} from "../lib/date-range";

interface UtmAnalyticsSectionProps {
  leads: Lead[];
}

export function UtmAnalyticsSection({ leads }: UtmAnalyticsSectionProps) {
  const [dateFilter, setDateFilter] = useState<UtmDateFilter>("month");

  const filteredLeads = useMemo(() => {
    const cutoff = getUtmDateCutoff(dateFilter);
    if (!cutoff) return leads;
    return leads.filter((lead) => new Date(lead.created_at) >= cutoff);
  }, [leads, dateFilter]);

  return (
    <section className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-base font-semibold">UTM Attribution</h2>
          <p className="text-sm text-muted-foreground">
            Where your leads are coming from across campaigns.
          </p>
        </div>
        <div className="flex flex-wrap gap-1.5 rounded-lg border border-border bg-background p-1">
          {UTM_DATE_FILTER_OPTIONS.map((option) => (
            <button
              key={option.value}
              type="button"
              onClick={() => setDateFilter(option.value)}
              className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors ${
                dateFilter === option.value
                  ? "bg-primary text-primary-foreground"
                  : "text-muted-foreground hover:bg-muted hover:text-foreground"
              }`}
            >
              {option.label}
            </button>
          ))}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-6">
        <UtmBarChart
          title="By Source"
          emptyMessage="No source data in this period"
          field="intake_source"
          leads={filteredLeads}
        />
        <UtmBarChart
          title="By Medium"
          emptyMessage="No medium data in this period"
          field="intake_medium"
          leads={filteredLeads}
        />
        <UtmBarChart
          title="By Campaign"
          emptyMessage="No campaign data in this period"
          field="intake_campaign"
          leads={filteredLeads}
        />
      </div>
    </section>
  );
}
