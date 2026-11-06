"use client";

import { useRouter } from "next/navigation";
import { Buildings } from "@phosphor-icons/react";
import { cn } from "@/lib/utils";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { Branch } from "@/types/database";

interface BranchSwitcherProps {
  branches: Branch[];
  maxBranches: number;
  userBranchId: string | null;
  leadScope: "all" | "own" | "team";
  selectedBranchId: string | null;
  /** Extra classes on the control (the header passes `max-md:hidden`; the mobile drawer shows its own copy). */
  className?: string;
}

export function BranchSwitcher({
  branches,
  maxBranches,
  userBranchId,
  leadScope,
  selectedBranchId,
  className,
}: BranchSwitcherProps) {
  const router = useRouter();

  if (maxBranches <= 1) return null;

  // Branch-scoped user: static informational badge, no dropdown
  if (leadScope !== "all" && userBranchId) {
    const branchName = branches.find((b) => b.id === userBranchId)?.name ?? "—";
    return (
      <div
        title={branchName}
        className={cn("inline-flex h-[30px] select-none items-center gap-1.5 rounded-ds-sm border border-ds-border bg-ds-surface px-2.5 text-[12.5px] font-medium text-ds-ink", className)}
      >
        <Buildings size={14} weight="regular" aria-hidden className="shrink-0 text-ds-muted" />
        <span className="max-w-[150px] truncate">{branchName}</span>
      </div>
    );
  }

  // Admin/owner: changeable dropdown backed by edgex_branch cookie
  if (leadScope === "all" && branches.length > 0) {
    function handleChange(value: string) {
      document.cookie = `edgex_branch=${value};path=/;max-age=31536000`;
      router.refresh();
    }

    const selectedName = selectedBranchId ? branches.find((b) => b.id === selectedBranchId)?.name : undefined;
    return (
      <Select value={selectedBranchId ?? "all"} onValueChange={handleChange}>
        <SelectTrigger
          size="sm"
          title={selectedName ?? "Overall"}
          className={cn("h-[30px] data-[size=sm]:h-[30px] w-auto gap-1.5 rounded-ds-sm border-ds-border bg-ds-surface px-2.5 text-[12.5px] font-medium text-ds-ink shadow-none [&_[data-slot=select-value]]:max-w-[150px] [&_[data-slot=select-value]]:truncate", className)}
        >
          <Buildings size={14} weight="regular" aria-hidden className="shrink-0 text-ds-muted" />
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          <SelectItem value="all">Overall</SelectItem>
          {branches.map((b) => (
            <SelectItem key={b.id} value={b.id}>
              {b.name}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    );
  }

  return null;
}
