"use client";

import { useRouter } from "next/navigation";
import { MapPin, ChevronDown } from "lucide-react";
import type { Branch } from "@/types/database";

interface BranchSwitcherProps {
  branches: Branch[];
  maxBranches: number;
  userBranchId: string | null;
  leadScope: "all" | "own" | "team";
  selectedBranchId: string | null;
}

export function BranchSwitcher({
  branches,
  maxBranches,
  userBranchId,
  leadScope,
  selectedBranchId,
}: BranchSwitcherProps) {
  const router = useRouter();

  if (maxBranches <= 1) return null;

  // Branch-scoped user: static informational badge, no dropdown
  if (leadScope !== "all" && userBranchId) {
    const branchName = branches.find((b) => b.id === userBranchId)?.name ?? "—";
    return (
      <div className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-blue-50 border border-blue-200 text-xs font-medium text-blue-700 select-none">
        <MapPin className="w-3 h-3 shrink-0" />
        {branchName}
      </div>
    );
  }

  // Admin/owner: changeable dropdown backed by edgex_branch cookie
  if (leadScope === "all" && branches.length > 0) {
    function handleChange(value: string) {
      document.cookie = `edgex_branch=${value};path=/;max-age=31536000`;
      router.refresh();
    }

    return (
      <div className="relative flex items-center">
        <MapPin className="absolute left-2 w-3.5 h-3.5 text-gray-500 pointer-events-none z-10" />
        <select
          value={selectedBranchId ?? "all"}
          onChange={(e) => handleChange(e.target.value)}
          className="pl-7 pr-6 py-1.5 text-xs font-medium rounded-lg border border-gray-300 bg-white text-gray-700 hover:border-gray-400 focus:outline-none focus:ring-2 focus:ring-primary/20 appearance-none cursor-pointer"
        >
          <option value="all">Overall</option>
          {branches.map((b) => (
            <option key={b.id} value={b.id}>
              {b.name}
            </option>
          ))}
        </select>
        <ChevronDown className="absolute right-1.5 w-3 h-3 text-gray-500 pointer-events-none" />
      </div>
    );
  }

  return null;
}
