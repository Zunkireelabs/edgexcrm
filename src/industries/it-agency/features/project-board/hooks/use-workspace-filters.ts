"use client";

import { useCallback } from "react";
import { useSearchParams, useRouter, usePathname } from "next/navigation";

export type WorkspaceView = "board" | "table";

export interface WorkspaceFilters {
  view: WorkspaceView;
  account: string;   // "__all__" or account.id
  owner: string;     // "__all__" or auth user_id
  q: string;
  showCancelled: boolean;
}

export function useWorkspaceFilters() {
  const searchParams = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();

  const filters: WorkspaceFilters = {
    view: (searchParams.get("view") as WorkspaceView) || "board",
    account: searchParams.get("account") || "__all__",
    owner: searchParams.get("owner") || "__all__",
    q: searchParams.get("q") || "",
    showCancelled: searchParams.get("cancelled") === "1",
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

      router.replace(`${pathname}?${params.toString()}`, { scroll: false });
    },
    [searchParams, router, pathname]
  );

  return { filters, setFilters };
}
