"use client";

import { useMemo, useState } from "react";
import { X } from "lucide-react";
import type { Lead } from "@/types/database";
import { UtmBarChart } from "./utm-bar-chart";
import type { UtmField } from "../lib/aggregation";
import {
  UTM_DATE_FILTER_OPTIONS,
  getUtmDateCutoff,
  type UtmDateFilter,
} from "../lib/date-range";

interface UtmAnalyticsSectionProps {
  leads: Lead[];
}

type Selections = Record<UtmField, string | null>;

const EMPTY_SELECTIONS: Selections = {
  intake_source: null,
  intake_medium: null,
  intake_campaign: null,
};

const FILTER_CHIP_LABELS: Record<UtmField, string> = {
  intake_source: "Source",
  intake_medium: "Medium",
  intake_campaign: "Campaign",
};

export function UtmAnalyticsSection({ leads }: UtmAnalyticsSectionProps) {
  const [dateFilter, setDateFilter] = useState<UtmDateFilter>("month");
  const [selected, setSelected] = useState<Selections>(EMPTY_SELECTIONS);

  const dateFilteredLeads = useMemo(() => {
    const cutoff = getUtmDateCutoff(dateFilter);
    if (!cutoff) return leads;
    return leads.filter((lead) => new Date(lead.created_at) >= cutoff);
  }, [leads, dateFilter]);

  function applySelections(except: UtmField): Lead[] {
    return dateFilteredLeads.filter((lead) => {
      for (const field of Object.keys(selected) as UtmField[]) {
        if (field === except) continue;
        const value = selected[field];
        if (value && lead[field] !== value) return false;
      }
      return true;
    });
  }

  function setFieldSelection(field: UtmField, value: string | null) {
    setSelected((prev) => ({ ...prev, [field]: value }));
  }

  function clearAll() {
    setSelected(EMPTY_SELECTIONS);
  }

  const activeFilters = (Object.keys(selected) as UtmField[]).filter(
    (field) => selected[field] !== null,
  );
  const hasActiveFilters = activeFilters.length > 0;

  return (
    <section className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-base font-semibold">UTM Attribution</h2>
          <p className="text-sm text-muted-foreground">
            Click a legend entry below each chart to filter.
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

      {hasActiveFilters && (
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs uppercase tracking-wide text-muted-foreground font-medium">
            Filtered by:
          </span>
          {activeFilters.map((field) => (
            <button
              key={field}
              type="button"
              onClick={() => setFieldSelection(field, null)}
              className="inline-flex items-center gap-1.5 rounded-full bg-primary/10 text-primary px-3 py-1 text-xs font-medium hover:bg-primary/15 transition-colors"
            >
              <span>
                {FILTER_CHIP_LABELS[field]}: {selected[field]}
              </span>
              <X className="h-3 w-3" />
            </button>
          ))}
          <button
            type="button"
            onClick={clearAll}
            className="ml-1 text-xs text-muted-foreground hover:text-foreground underline-offset-2 hover:underline"
          >
            Clear all
          </button>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-6">
        <UtmBarChart
          title="By Source"
          emptyMessage="No source data in this period"
          field="intake_source"
          leads={applySelections("intake_source")}
          selectedValue={selected.intake_source}
          onSelect={(value) => setFieldSelection("intake_source", value)}
        />
        <UtmBarChart
          title="By Medium"
          emptyMessage="No medium data in this period"
          field="intake_medium"
          leads={applySelections("intake_medium")}
          selectedValue={selected.intake_medium}
          onSelect={(value) => setFieldSelection("intake_medium", value)}
        />
        <UtmBarChart
          title="By Campaign"
          emptyMessage="No campaign data in this period"
          field="intake_campaign"
          leads={applySelections("intake_campaign")}
          selectedValue={selected.intake_campaign}
          onSelect={(value) => setFieldSelection("intake_campaign", value)}
        />
      </div>
    </section>
  );
}
