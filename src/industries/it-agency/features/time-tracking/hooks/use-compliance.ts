"use client";

import { useState, useEffect, useCallback } from "react";

export type ComplianceStatus = "no_logs" | "gaps" | "on_track" | "none";

export interface ComplianceRow {
  tenantUserId: string;
  userId: string;
  name: string | null;
  email: string;
  role: string;
  workingDays: number;
  loggedDays: number;
  missingDays: string[];
  leaveDays: string[];
  totalMinutes: number;
  perDayMinutes: Record<string, number>;
  status: ComplianceStatus;
}

export interface ComplianceSummary {
  members: number;
  fullyLogged: number;
  withGaps: number;
  noLogs: number;
}

export interface ComplianceRange {
  from: string;
  to: string;
}

interface ComplianceResponse {
  from: string;
  to: string;
  todayISO: string;
  rows: ComplianceRow[];
  summary: ComplianceSummary;
}

function buildUrl(range: ComplianceRange): string {
  const params = new URLSearchParams();
  if (range.from) params.set("from", range.from);
  if (range.to) params.set("to", range.to);
  const qs = params.toString();
  return qs ? `/api/v1/time-entries/compliance?${qs}` : "/api/v1/time-entries/compliance";
}

export function useCompliance(range: ComplianceRange) {
  const [rows, setRows] = useState<ComplianceRow[]>([]);
  const [summary, setSummary] = useState<ComplianceSummary>({ members: 0, fullyLogged: 0, withGaps: 0, noLogs: 0 });
  const [todayISO, setTodayISO] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchCompliance = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(buildUrl(range));
      if (!res.ok) throw new Error("Failed to load compliance data");
      const { data } = (await res.json()) as { data: ComplianceResponse };
      setRows(data.rows ?? []);
      setSummary(data.summary ?? { members: 0, fullyLogged: 0, withGaps: 0, noLogs: 0 });
      setTodayISO(data.todayISO ?? null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  // Stringify range so the dep array is stable across renders
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [JSON.stringify(range)]);

  useEffect(() => {
    fetchCompliance();
  }, [fetchCompliance]);

  return { rows, summary, todayISO, loading, error, refetch: fetchCompliance };
}
