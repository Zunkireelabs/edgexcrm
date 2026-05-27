"use client";

import { useState, useEffect, useMemo } from "react";
import { toast } from "sonner";
import type { Account, Project } from "@/types/database";

export interface TeamMember {
  id: string;
  user_id: string;
  email: string;
  role: string;
  default_hourly_rate: number | null;
}

export function useProjects() {
  const [projects, setProjects] = useState<Project[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [team, setTeam] = useState<TeamMember[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    Promise.all([
      fetch("/api/v1/projects").then((r) => r.json()),
      fetch("/api/v1/accounts").then((r) => r.json()),
      fetch("/api/v1/team").then((r) => r.json()),
    ])
      .then(([pRes, aRes, tRes]) => {
        setProjects(pRes.data ?? []);
        setAccounts(aRes.data ?? []);
        setTeam(tRes.data ?? []);
      })
      .catch(() => toast.error("Failed to load workspace"))
      .finally(() => setLoading(false));
  }, []);

  const accountMap = useMemo(
    () => new Map(accounts.map((a) => [a.id, a])),
    [accounts]
  );

  // Team keyed by auth user_id
  const teamMap = useMemo(
    () => new Map(team.map((m) => [m.user_id, m])),
    [team]
  );

  return { projects, accounts, team, accountMap, teamMap, loading, setProjects };
}
