"use client";

import { useState, useMemo } from "react";
import { ArrowUp, ArrowDown, ArrowUpDown, LayoutGrid } from "lucide-react";
import {
  Table,
  TableBody,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import type { ProjectWithAccount } from "../project-card";
import type { TeamMember } from "../../hooks/use-projects";
import { ProjectRow } from "../project-row";

type SortKey = "name" | "account_name" | "owner" | "status" | "updated_at";
type SortDir = "asc" | "desc";

function SortIcon({ col, sortKey, dir }: { col: SortKey; sortKey: SortKey; dir: SortDir }) {
  if (col !== sortKey) return <ArrowUpDown className="h-3 w-3 opacity-40" />;
  return dir === "asc" ? <ArrowUp className="h-3 w-3" /> : <ArrowDown className="h-3 w-3" />;
}

interface TableViewProps {
  projects: ProjectWithAccount[];
  team: TeamMember[];
  teamMap: Map<string, TeamMember>;
  onProjectUpdated: (updated: ProjectWithAccount) => void;
  onClearFilters: () => void;
}

export function TableView({ projects, team, teamMap, onProjectUpdated, onClearFilters }: TableViewProps) {
  const [sortKey, setSortKey] = useState<SortKey>("updated_at");
  const [sortDir, setSortDir] = useState<SortDir>("desc");

  function handleSort(key: SortKey) {
    if (key === sortKey) setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    else { setSortKey(key); setSortDir("asc"); }
  }

  const sorted = useMemo(() => {
    return [...projects].sort((a, b) => {
      let aVal: string;
      let bVal: string;
      if (sortKey === "owner") {
        aVal = (a.owner_id ? teamMap.get(a.owner_id)?.email : "") ?? "";
        bVal = (b.owner_id ? teamMap.get(b.owner_id)?.email : "") ?? "";
      } else {
        aVal = String(a[sortKey] ?? "");
        bVal = String(b[sortKey] ?? "");
      }
      const cmp = aVal.localeCompare(bVal);
      return sortDir === "asc" ? cmp : -cmp;
    });
  }, [projects, sortKey, sortDir, teamMap]);

  if (projects.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 gap-2 text-center">
        <LayoutGrid className="h-8 w-8 text-muted-foreground/40" />
        <p className="text-sm text-muted-foreground">No projects match these filters.</p>
        <button
          type="button"
          onClick={onClearFilters}
          className="text-xs text-gray-600 hover:text-[#0f0f10] hover:underline underline-offset-2"
        >
          Clear filters
        </button>
      </div>
    );
  }

  const headCls = "text-xs font-medium text-gray-600 cursor-pointer hover:text-gray-900 select-none";

  return (
    <Table>
      <TableHeader>
        <TableRow className="bg-gray-50 border-b border-gray-200">
          <TableHead
            className={headCls}
            onClick={() => handleSort("name")}
            aria-sort={sortKey === "name" ? (sortDir === "asc" ? "ascending" : "descending") : "none"}
          >
            <span className="flex items-center gap-1">Project <SortIcon col="name" sortKey={sortKey} dir={sortDir} /></span>
          </TableHead>
          <TableHead
            className={headCls}
            onClick={() => handleSort("account_name")}
            aria-sort={sortKey === "account_name" ? (sortDir === "asc" ? "ascending" : "descending") : "none"}
          >
            <span className="flex items-center gap-1">Account <SortIcon col="account_name" sortKey={sortKey} dir={sortDir} /></span>
          </TableHead>
          <TableHead
            className={headCls}
            onClick={() => handleSort("owner")}
            aria-sort={sortKey === "owner" ? (sortDir === "asc" ? "ascending" : "descending") : "none"}
          >
            <span className="flex items-center gap-1">Owner <SortIcon col="owner" sortKey={sortKey} dir={sortDir} /></span>
          </TableHead>
          <TableHead
            className={headCls}
            onClick={() => handleSort("status")}
            aria-sort={sortKey === "status" ? (sortDir === "asc" ? "ascending" : "descending") : "none"}
          >
            <span className="flex items-center gap-1">Status <SortIcon col="status" sortKey={sortKey} dir={sortDir} /></span>
          </TableHead>
          <TableHead
            className={headCls}
            onClick={() => handleSort("updated_at")}
            aria-sort={sortKey === "updated_at" ? (sortDir === "asc" ? "ascending" : "descending") : "none"}
          >
            <span className="flex items-center gap-1">Updated <SortIcon col="updated_at" sortKey={sortKey} dir={sortDir} /></span>
          </TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {sorted.map((project) => (
          <ProjectRow
            key={project.id}
            project={project}
            team={team}
            onProjectUpdated={onProjectUpdated}
          />
        ))}
      </TableBody>
    </Table>
  );
}
