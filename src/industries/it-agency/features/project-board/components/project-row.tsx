"use client";

import Link from "next/link";
import { useState } from "react";
import { toast } from "sonner";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { ProjectStatus } from "@/types/database";
import type { ProjectWithAccount } from "./project-card";
import type { TeamMember } from "../hooks/use-projects";
import { StatusPill } from "./status-pill";
import { OwnerPicker } from "./owner-picker";

const PROJECT_STATUS_OPTIONS: { value: ProjectStatus; label: string }[] = [
  { value: "planning",  label: "Discovery" },
  { value: "active",    label: "In Progress" },
  { value: "in_review", label: "Review" },
  { value: "delivered", label: "Delivered" },
  { value: "on_hold",   label: "On Hold" },
  { value: "cancelled", label: "Cancelled" },
];

function relativeTime(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const diffMin = Math.floor(diffMs / 60000);
  if (diffMin < 1) return "just now";
  if (diffMin < 60) return `${diffMin}m ago`;
  const diffHr = Math.floor(diffMin / 60);
  if (diffHr < 24) return `${diffHr}h ago`;
  const diffDays = Math.floor(diffHr / 24);
  if (diffDays < 30) return `${diffDays}d ago`;
  return `${Math.floor(diffDays / 30)}mo ago`;
}

interface ProjectRowProps {
  project: ProjectWithAccount;
  team: TeamMember[];
  onProjectUpdated: (updated: ProjectWithAccount) => void;
}

export function ProjectRow({ project, team, onProjectUpdated }: ProjectRowProps) {
  const [saving, setSaving] = useState(false);

  async function patchProject(patch: Record<string, unknown>) {
    setSaving(true);
    try {
      const res = await fetch(`/api/v1/projects/${project.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        throw new Error(json.error?.message ?? "Failed to update");
      }
      const { data } = await res.json();
      onProjectUpdated({ ...data, account_name: project.account_name });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to update project");
    } finally {
      setSaving(false);
    }
  }

  return (
    <tr className={`border-b border-gray-100 hover:bg-gray-50/50 transition-colors ${saving ? "opacity-60" : ""}`}>
      <td className="py-2.5 px-3">
        <Link
          href={`/time-tracking/projects/${project.id}`}
          className="text-sm font-medium text-gray-900 hover:text-blue-600 hover:underline"
        >
          {project.name}
        </Link>
      </td>
      <td className="py-2.5 px-3 text-sm text-gray-500">{project.account_name}</td>
      <td className="py-2.5 px-3">
        <OwnerPicker
          ownerId={project.owner_id}
          team={team}
          onChange={(userId) => patchProject({ owner_id: userId })}
          disabled={saving}
        />
      </td>
      <td className="py-2.5 px-3">
        <Select
          value={project.status}
          onValueChange={(v) => patchProject({ status: v })}
          disabled={saving}
        >
          <SelectTrigger className="h-7 w-auto text-xs border-0 p-0 shadow-none focus:ring-0 bg-transparent gap-1">
            <StatusPill status={project.status} />
          </SelectTrigger>
          <SelectContent>
            {PROJECT_STATUS_OPTIONS.map((o) => (
              <SelectItem key={o.value} value={o.value} className="text-xs">
                {o.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </td>
      <td className="py-2.5 px-3 text-xs text-gray-400">{relativeTime(project.updated_at)}</td>
    </tr>
  );
}
