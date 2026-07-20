"use client";

import { useState, useEffect, useCallback } from "react";
import { toast } from "sonner";
import type { Project, ProjectEvent } from "@/types/database";

interface TeamMember {
  user_id: string;
  email: string;
}

export function useProjectCockpit(projectId: string) {
  const [project, setProject] = useState<Project | null>(null);
  const [events, setEvents] = useState<ProjectEvent[]>([]);
  const [accountName, setAccountName] = useState<string | null>(null);
  const [ownerEmail, setOwnerEmail] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async (silent = false) => {
    if (!silent) setLoading(true);
    try {
      const [pRes, eRes] = await Promise.all([
        fetch(`/api/v1/projects/${projectId}`).then((r) => r.json()),
        fetch(`/api/v1/projects/${projectId}/events`).then((r) => r.json()),
      ]);
      const loadedProject: Project | null = pRes.data ?? null;
      setProject(loadedProject);
      setEvents(eRes.data ?? []);

      if (loadedProject) {
        const [aRes, tRes] = await Promise.all([
          fetch(`/api/v1/accounts/${loadedProject.account_id}`).then((r) => r.json()),
          fetch(`/api/v1/team`).then((r) => r.json()),
        ]);
        setAccountName(aRes.data?.name ?? null);
        const team: TeamMember[] = tRes.data ?? [];
        setOwnerEmail(team.find((m) => m.user_id === loadedProject.owner_id)?.email ?? null);
      }
    } catch {
      toast.error("Failed to load project");
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    load();
  }, [load]);

  const refetchEvents = useCallback(async () => {
    const eRes = await fetch(`/api/v1/projects/${projectId}/events`).then((r) => r.json());
    setEvents(eRes.data ?? []);
  }, [projectId]);

  async function updateProject(patch: Record<string, unknown>): Promise<boolean> {
    const res = await fetch(`/api/v1/projects/${projectId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(patch),
    });
    const json = await res.json();
    if (!res.ok) {
      toast.error(json.error?.message ?? "Failed to update project");
      return false;
    }
    await load(true);
    return true;
  }

  async function addRetroLesson(lesson: string): Promise<boolean> {
    const res = await fetch(`/api/v1/projects/${projectId}/retro-lessons`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ lesson }),
    });
    const json = await res.json();
    if (!res.ok) {
      toast.error(json.error?.message ?? "Failed to add retro lesson");
      return false;
    }
    await refetchEvents();
    return true;
  }

  async function qualifyProject(payload: Record<string, unknown>): Promise<boolean> {
    const res = await fetch(`/api/v1/projects/${projectId}/qualify`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });
    const json = await res.json();
    if (!res.ok) {
      toast.error(json.error?.message ?? "Failed to qualify project");
      return false;
    }
    await load(true);
    return true;
  }

  return {
    project,
    events,
    accountName,
    ownerEmail,
    loading,
    // Silent — used to refresh in-place after a mutation elsewhere on the
    // page (e.g. a change request approval); must not remount the tree and
    // reset the active tab back to its default.
    refetch: useCallback(() => load(true), [load]),
    refetchEvents,
    updateProject,
    qualifyProject,
    addRetroLesson,
  };
}
