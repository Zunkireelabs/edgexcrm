"use client";

import { useState, useEffect, useMemo, useCallback } from "react";
import { toast } from "sonner";
import type { Account, Project } from "@/types/database";

export interface TeamMember {
  id: string;
  user_id: string;
  email: string;
  name?: string | null;
  role: string;
  default_hourly_rate: number | null;
}

// Project augmented with contact count extracted from PostgREST embed
export type ProjectWithMetrics = Project & { contact_count: number };

interface RawProjectResponse extends Project {
  project_contacts?: Array<{ count: string }> | null;
}

interface HoursSummaryRow {
  key: string;
  billable_minutes: number;
}

export function useProjects() {
  const [projects, setProjectsRaw] = useState<ProjectWithMetrics[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [team, setTeam] = useState<TeamMember[]>([]);
  // projectId → billable_minutes
  const [hoursMap, setHoursMap] = useState<Map<string, number>>(new Map());
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [pRes, aRes, tRes, hRes] = await Promise.all([
        fetch("/api/v1/projects").then((r) => r.json()),
        fetch("/api/v1/accounts").then((r) => r.json()),
        fetch("/api/v1/team").then((r) => r.json()),
        fetch("/api/v1/time-entries/summary?dimension=project").then((r) => r.json()),
      ]);

      const rawProjects: RawProjectResponse[] = pRes.data ?? [];
      setProjectsRaw(
        rawProjects.map((p) => ({
          ...p,
          contact_count: p.project_contacts?.[0]?.count != null
            ? parseInt(String(p.project_contacts[0].count), 10)
            : 0,
        }))
      );
      setAccounts(aRes.data ?? []);
      setTeam(tRes.data ?? []);

      const hrs = new Map<string, number>();
      for (const row of (hRes.data ?? []) as HoursSummaryRow[]) {
        hrs.set(row.key, row.billable_minutes);
      }
      setHoursMap(hrs);
    } catch {
      toast.error("Failed to load workspace");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const accountMap = useMemo(
    () => new Map(accounts.map((a) => [a.id, a])),
    [accounts]
  );

  const teamMap = useMemo(
    () => new Map(team.map((m) => [m.user_id, m])),
    [team]
  );

  function setProjects(updater: (prev: ProjectWithMetrics[]) => ProjectWithMetrics[]) {
    setProjectsRaw(updater);
  }

  return {
    projects,
    accounts,
    team,
    accountMap,
    teamMap,
    hoursMap,
    loading,
    refetch: load,
    setProjects,
  };
}
