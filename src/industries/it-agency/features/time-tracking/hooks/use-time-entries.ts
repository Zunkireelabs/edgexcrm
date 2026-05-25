"use client";

import { useState, useEffect, useCallback } from "react";
import type { TimeEntry } from "@/types/database";

export interface TimeEntryWithJoins extends TimeEntry {
  projects: { id: string; name: string; account_id: string } | null;
  tasks: { id: string; title: string } | null;
}

export interface DateGroup {
  date: string;
  label: string;
  entries: TimeEntryWithJoins[];
  totalMinutes: number;
}

export interface WeekGroup {
  weekKey: string;
  weekLabel: string;
  dateGroups: DateGroup[];
}

export interface TimeEntriesFilters {
  userId?: string;
  projectId?: string;
  from?: string;
  to?: string;
  approvalStatus?: string;
}

// ── Date helpers ────────────────────────────────────────────────

function isoWeekMonday(dateStr: string): string {
  const d = new Date(dateStr + "T00:00:00");
  const day = d.getDay();
  const offset = day === 0 ? -6 : 1 - day; // shift to Monday
  d.setDate(d.getDate() + offset);
  return d.toISOString().split("T")[0];
}

function shortDate(dateStr: string): string {
  const d = new Date(dateStr + "T00:00:00");
  return d.toLocaleDateString("en-US", { month: "short", day: "numeric" });
}

function weekLabel(mondayStr: string): string {
  const monday = new Date(mondayStr + "T00:00:00");
  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);
  return `Week of ${shortDate(mondayStr)} – ${shortDate(sunday.toISOString().split("T")[0])}`;
}

export function formatDateLabel(dateStr: string): string {
  const d = new Date(dateStr + "T00:00:00");
  return d.toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
  });
}

export function formatMinutes(min: number): string {
  if (min <= 0) return "0m";
  const h = Math.floor(min / 60);
  const m = min % 60;
  if (h === 0) return `${m}m`;
  if (m === 0) return `${h}h`;
  return `${h}h ${m}m`;
}

// ── Grouping ────────────────────────────────────────────────────

export function groupByWeek(entries: TimeEntryWithJoins[]): WeekGroup[] {
  if (entries.length === 0) return [];

  // Sort descending by date
  const sorted = [...entries].sort((a, b) => b.entry_date.localeCompare(a.entry_date));

  // Build date → entries map
  const byDate = new Map<string, TimeEntryWithJoins[]>();
  for (const e of sorted) {
    const g = byDate.get(e.entry_date) ?? [];
    g.push(e);
    byDate.set(e.entry_date, g);
  }

  // Build weekKey → [date] map (all dates in that week, sorted desc)
  const byWeek = new Map<string, string[]>();
  for (const date of byDate.keys()) {
    const wk = isoWeekMonday(date);
    const ds = byWeek.get(wk) ?? [];
    ds.push(date);
    byWeek.set(wk, ds);
  }

  const weeks: WeekGroup[] = [];
  for (const [wk, dates] of byWeek) {
    const sortedDates = [...dates].sort((a, b) => b.localeCompare(a));
    const dateGroups: DateGroup[] = sortedDates.map((date) => {
      const grpEntries = byDate.get(date) ?? [];
      return {
        date,
        label: formatDateLabel(date),
        entries: grpEntries,
        totalMinutes: grpEntries.reduce((sum, e) => sum + e.minutes, 0),
      };
    });
    weeks.push({ weekKey: wk, weekLabel: weekLabel(wk), dateGroups });
  }

  // Sort weeks descending (most recent first)
  return weeks.sort((a, b) => b.weekKey.localeCompare(a.weekKey));
}

// ── Hook ────────────────────────────────────────────────────────

function buildUrl(filters: TimeEntriesFilters): string {
  const params = new URLSearchParams();
  if (filters.userId) params.set("user_id", filters.userId);
  if (filters.projectId) params.set("project_id", filters.projectId);
  if (filters.from) params.set("from", filters.from);
  if (filters.to) params.set("to", filters.to);
  if (filters.approvalStatus) params.set("approval_status", filters.approvalStatus);
  const qs = params.toString();
  return qs ? `/api/v1/time-entries?${qs}` : "/api/v1/time-entries";
}

export function useTimeEntries(filters: TimeEntriesFilters = {}) {
  const [entries, setEntries] = useState<TimeEntryWithJoins[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchEntries = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(buildUrl(filters));
      if (!res.ok) throw new Error("Failed to load time entries");
      const { data } = await res.json();
      setEntries((data ?? []) as TimeEntryWithJoins[]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  // Stringify filters so the dep array is stable across renders
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(filters)]);

  useEffect(() => {
    fetchEntries();
  }, [fetchEntries]);

  function addEntry(entry: TimeEntryWithJoins) {
    setEntries((prev) => [entry, ...prev]);
  }

  function updateEntry(updated: TimeEntryWithJoins) {
    setEntries((prev) => prev.map((e) => (e.id === updated.id ? updated : e)));
  }

  function removeEntry(id: string) {
    setEntries((prev) => prev.filter((e) => e.id !== id));
  }

  const weekGroups = groupByWeek(entries);
  const now = new Date();
  const thisWeekMonday = isoWeekMonday(now.toISOString().split("T")[0]);
  const totalMinutesThisWeek = entries
    .filter((e) => isoWeekMonday(e.entry_date) === thisWeekMonday)
    .reduce((sum, e) => sum + e.minutes, 0);

  return {
    entries,
    weekGroups,
    loading,
    error,
    totalMinutesThisWeek,
    addEntry,
    updateEntry,
    removeEntry,
    refetch: fetchEntries,
  };
}
