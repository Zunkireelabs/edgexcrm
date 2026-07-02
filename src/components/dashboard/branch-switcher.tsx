"use client";

import { useRouter } from "next/navigation";
import { MapPin } from "lucide-react";
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
      <Select value={selectedBranchId ?? "all"} onValueChange={handleChange}>
        <SelectTrigger size="sm" className="w-auto gap-1.5 px-2.5 text-xs font-medium rounded-lg border-gray-200 bg-white text-gray-700">
          <MapPin className="w-3.5 h-3.5 text-gray-500 shrink-0" />
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
