"use client";

import { useCallback } from "react";
import { useSearchParams, useRouter, usePathname } from "next/navigation";
import type { ProjectStatus } from "@/types/database";

export type WorkspaceView = "board" | "table";

export interface WorkspaceFilters {
  view: WorkspaceView;
  account: string;         // "__all__" or account.id
  owner: string;           // "__all__" or auth user_id
  q: string;
  showCancelled: boolean;
  statuses: ProjectStatus[]; // empty = all visible
}

const ALL_STATUSES: ProjectStatus[] = [
  "planning",
  "active",
  "in_review",
  "delivered",
  "on_hold",
  "cancelled",
];

export function useWorkspaceFilters() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();

  const rawStatus = searchParams.get("status");
  const parsedStatuses: ProjectStatus[] = rawStatus
    ? (rawStatus.split(",").filter((s) => ALL_STATUSES.includes(s as ProjectStatus)) as ProjectStatus[])
    : [];

  const filters: WorkspaceFilters = {
    view: (searchParams.get("view") as WorkspaceView) || "board",
    account: searchParams.get("account") || "__all__",
    owner: searchParams.get("owner") || "__all__",
    q: searchParams.get("q") || "",
    showCancelled: searchParams.get("cancelled") === "1",
    statuses: parsedStatuses,
  };

  const setFilters = useCallback(
    (next: Partial<WorkspaceFilters>) => {
      const params = new URLSearchParams(searchParams.toString());

      if (next.view !== undefined) params.set("view", next.view);

      if (next.account !== undefined) {
        if (next.account === "__all__") params.delete("account");
        else params.set("account", next.account);
      }

      if (next.owner !== undefined) {
        if (next.owner === "__all__") params.delete("owner");
        else params.set("owner", next.owner);
      }

      if (next.q !== undefined) {
        if (next.q === "") params.delete("q");
        else params.set("q", next.q);
      }

      if (next.showCancelled !== undefined) {
        if (next.showCancelled) params.set("cancelled", "1");
        else params.delete("cancelled");
      }

      if (next.statuses !== undefined) {
        if (next.statuses.length === 0) params.delete("status");
        else params.set("status", next.statuses.join(","));
      }

      router.replace(`${pathname}?${params.toString()}`, { scroll: false });
    },
    [searchParams, router, pathname]
  );

  return { filters, setFilters };
}
