"use client";

import { useState, useMemo, useCallback } from "react";
import { Plus, LayoutGrid, List, Search, Download, ArrowUpDown } from "lucide-react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { FilterDropdown } from "@/components/ui/filter-dropdown";
import { FilterMenu, FilterChips, type FilterDef } from "@/components/ui/filter-menu";
import { DealBoard } from "../components/deal-board";
import { DealsTable } from "../components/deals-table";
import { AddDealSheet } from "../components/add-deal-sheet";
import { DealPipelineSelector } from "../components/deal-pipeline-selector";
import { weightedTotal } from "../components/deal-column";
import { formatMoney } from "@/lib/travel/currency";
import type { Deal, DealStage, DealPipelineWithCounts, UserRole } from "@/types/database";
import type { TeamMember } from "@/lib/supabase/queries";

interface DealsWorkspaceProps {
  tenantId: string;
  role: UserRole;
  pipelines: DealPipelineWithCounts[];
  selectedPipelineId: string;
  stages: DealStage[];
  deals: Deal[];
  teamMembers: TeamMember[];
}

type View = "board" | "list";
type SortField = "created_at" | "updated_at" | "name" | "amount" | "close_date";
type SortDir = "asc" | "desc";

const SORT_OPTIONS = [
  { value: "created_at:desc", label: "Newest first" },
  { value: "created_at:asc", label: "Oldest first" },
  { value: "updated_at:desc", label: "Recently updated" },
  { value: "name:asc", label: "Name A–Z" },
  { value: "name:desc", label: "Name Z–A" },
  { value: "amount:desc", label: "Amount (high to low)" },
  { value: "amount:asc", label: "Amount (low to high)" },
  { value: "close_date:asc", label: "Close date (soonest)" },
  { value: "close_date:desc", label: "Close date (latest)" },
];

const DATE_OPTIONS = [
  { value: "all", label: "Any time" },
  { value: "today", label: "Today" },
  { value: "week", label: "This week" },
  { value: "month", label: "This month" },
];

function isWithinRange(dateStr: string | null, range: string): boolean {
  if (!dateStr || range === "all") return true;
  const date = new Date(dateStr);
  const now = new Date();
  const start = new Date();
  if (range === "today") {
    start.setHours(0, 0, 0, 0);
  } else if (range === "week") {
    start.setDate(now.getDate() - 7);
  } else if (range === "month") {
    start.setDate(now.getDate() - 30);
  }
  return date >= start;
}

function exportDealsCSV(deals: Deal[], stages: DealStage[], members: TeamMember[]) {
  const stageMap = new Map(stages.map((s) => [s.id, s.name]));
  const memberMap = new Map(members.map((m) => [m.user_id, m.email]));

  const headers = ["Name", "Account", "Contact", "Amount", "Currency", "Stage", "Owner", "Close Date", "Status"];
  const rows = deals.map((d) => [
    d.name,
    d.accounts?.name ?? "",
    d.contacts ? `${d.contacts.first_name} ${d.contacts.last_name}`.trim() : "",
    d.amount != null ? String(d.amount) : "",
    d.currency,
    stageMap.get(d.stage_id) ?? "",
    d.owner_id ? (memberMap.get(d.owner_id) ?? "") : "",
    d.close_date ?? "",
    d.status,
  ]);

  const csv = [headers, ...rows]
    .map((row) => row.map((cell) => `"${String(cell).replace(/"/g, '""')}"`).join(","))
    .join("\n");

  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "deals.csv";
  link.click();
  URL.revokeObjectURL(url);
}

export function DealsWorkspace({
  tenantId,
  role,
  pipelines,
  selectedPipelineId,
  stages: initialStages,
  deals: initialDeals,
  teamMembers,
}: DealsWorkspaceProps) {
  const isAdmin = role === "owner" || role === "admin";
  const router = useRouter();

  const [view, setView] = useState<View>("board");
  const [stages, setStages] = useState<DealStage[]>(initialStages);
  const [deals, setDeals] = useState<Deal[]>(initialDeals);
  const [addOpen, setAddOpen] = useState(false);

  // Filters
  const [search, setSearch] = useState("");
  const [ownerFilter, setOwnerFilter] = useState("all");
  const [typeFilter, setTypeFilter] = useState("all");
  const [priorityFilter, setPriorityFilter] = useState("all");
  const [dateFilter, setDateFilter] = useState("all");

  // Sort
  const [sortValue, setSortValue] = useState("created_at:desc");
  const [sortField, sortDir] = sortValue.split(":") as [SortField, SortDir];

  const ownerOptions = useMemo(() => [
    { value: "all", label: "All owners" },
    { value: "unassigned", label: "Unassigned" },
    ...teamMembers.map((m) => ({ value: m.user_id, label: m.name || m.email.split("@")[0] })),
  ], [teamMembers]);

  const typeOptions = useMemo(() => {
    const types = Array.from(new Set(deals.map((d) => d.deal_type).filter(Boolean))) as string[];
    return [
      { value: "all", label: "All types" },
      ...types.map((t) => ({ value: t, label: t })),
    ];
  }, [deals]);

  const priorityOptions = [
    { value: "all", label: "All priorities" },
    { value: "high", label: "High" },
    { value: "medium", label: "Medium" },
    { value: "low", label: "Low" },
  ];

  const filteredDeals = useMemo(() => {
    let result = deals;

    if (search) result = result.filter((d) => d.name.toLowerCase().includes(search.toLowerCase()));
    if (ownerFilter !== "all") {
      result = ownerFilter === "unassigned"
        ? result.filter((d) => !d.owner_id)
        : result.filter((d) => d.owner_id === ownerFilter);
    }
    if (typeFilter !== "all") result = result.filter((d) => d.deal_type === typeFilter);
    if (priorityFilter !== "all") result = result.filter((d) => d.priority === priorityFilter);
    if (dateFilter !== "all") result = result.filter((d) => isWithinRange(d.created_at, dateFilter));

    // Sort
    result = [...result].sort((a, b) => {
      let aVal: string | number | null = null;
      let bVal: string | number | null = null;

      if (sortField === "amount") {
        aVal = a.amount ?? -1;
        bVal = b.amount ?? -1;
      } else if (sortField === "name") {
        aVal = a.name.toLowerCase();
        bVal = b.name.toLowerCase();
      } else if (sortField === "close_date") {
        aVal = a.close_date ?? "";
        bVal = b.close_date ?? "";
      } else if (sortField === "updated_at") {
        aVal = a.updated_at;
        bVal = b.updated_at;
      } else {
        aVal = a.created_at;
        bVal = b.created_at;
      }

      if (aVal === null || aVal === undefined) aVal = "";
      if (bVal === null || bVal === undefined) bVal = "";

      const cmp = aVal < bVal ? -1 : aVal > bVal ? 1 : 0;
      return sortDir === "asc" ? cmp : -cmp;
    });

    return result;
  }, [deals, search, ownerFilter, typeFilter, priorityFilter, dateFilter, sortField, sortDir]);

  const weightedPipeline = useMemo(() => {
    const stageMap = new Map(stages.map((s) => [s.id, s]));
    const byStage = new Map<string, Deal[]>();
    for (const d of filteredDeals) {
      const arr = byStage.get(d.stage_id) ?? [];
      arr.push(d);
      byStage.set(d.stage_id, arr);
    }
    let sum = 0;
    for (const [stageId, stageDeals] of byStage) {
      const stage = stageMap.get(stageId);
      if (stage) sum += weightedTotal(stageDeals, stage.probability);
    }
    return sum;
  }, [filteredDeals, stages]);

  const activeFilterCount = [
    search ? 1 : 0,
    ownerFilter !== "all" ? 1 : 0,
    typeFilter !== "all" ? 1 : 0,
    priorityFilter !== "all" ? 1 : 0,
    dateFilter !== "all" ? 1 : 0,
  ].reduce((a, b) => a + b, 0);

  const clearFilters = () => {
    setSearch("");
    setOwnerFilter("all");
    setTypeFilter("all");
    setPriorityFilter("all");
    setDateFilter("all");
  };

  const handleRefresh = useCallback(() => {
    router.refresh();
  }, [router]);

  const handleDealCreated = useCallback(() => {
    router.refresh();
  }, [router]);

  const filterDefs: FilterDef[] = [
    {
      id: "owner",
      label: "Owner",
      multiple: false,
      searchable: true,
      defaultValue: "all",
      value: ownerFilter,
      onChange: setOwnerFilter,
      options: ownerOptions,
    },
    {
      id: "type",
      label: "Deal Type",
      multiple: false,
      searchable: false,
      defaultValue: "all",
      value: typeFilter,
      onChange: setTypeFilter,
      options: typeOptions,
    },
    {
      id: "priority",
      label: "Priority",
      multiple: false,
      searchable: false,
      defaultValue: "all",
      value: priorityFilter,
      onChange: setPriorityFilter,
      options: priorityOptions,
    },
    {
      id: "created",
      label: "Created",
      multiple: false,
      searchable: false,
      defaultValue: "all",
      value: dateFilter,
      onChange: setDateFilter,
      options: DATE_OPTIONS,
    },
  ];

  return (
    <div className="flex flex-col flex-1 min-h-0 gap-1">
      {/* Header */}
      <div className="flex items-center justify-between gap-3 shrink-0">
        <div>
          <h1 className="text-xl font-bold">Deals</h1>
          <p className="text-sm text-muted-foreground">
            {deals.length} deal{deals.length !== 1 ? "s" : ""}
            {filteredDeals.length > 0 && (
              <span className="ml-2">
                · Weighted pipeline: <span className="font-medium text-foreground">{formatMoney(weightedPipeline, filteredDeals[0]?.currency ?? "NPR")}</span>
              </span>
            )}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <DealPipelineSelector
            pipelines={pipelines}
            selectedPipelineId={selectedPipelineId}
            role={role}
            tenantId={tenantId}
          />
          {isAdmin && (
            <Button size="sm" onClick={() => setAddOpen(true)}>
              <Plus className="h-4 w-4 mr-1.5" />
              Add Deal
            </Button>
          )}
        </div>
      </div>

      {/* Filter toolbar */}
      <div className="flex flex-wrap items-center gap-2 shrink-0 bg-card px-3 py-2">
        {/* Search */}
        <div className="relative w-52">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3 w-3 text-muted-foreground" />
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search deals..."
            className="w-full h-7 pl-7 pr-3 rounded-md border border-input bg-background text-xs placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-ring"
          />
        </div>

        <FilterMenu filters={filterDefs} activeCount={activeFilterCount} onClearAll={clearFilters} />

        <div className="flex-1" />

        {/* Sort */}
        <FilterDropdown
          label="Sort"
          value={sortValue}
          onChange={setSortValue}
          options={SORT_OPTIONS}
          icon={<ArrowUpDown className="h-3 w-3" />}
          searchable={false}
        />

        {/* Export CSV */}
        <button
          type="button"
          onClick={() => exportDealsCSV(filteredDeals, stages, teamMembers)}
          className="inline-flex items-center gap-1.5 h-7 px-2.5 text-xs font-medium rounded-md border border-gray-300 bg-white text-gray-600 hover:bg-[#0000170b] transition-colors"
          title="Export CSV"
        >
          <Download className="h-3 w-3" />
          Export
        </button>

        {/* View toggle */}
        <div className="flex rounded-md border overflow-hidden">
          <button
            type="button"
            onClick={() => setView("board")}
            className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium transition-colors ${
              view === "board" ? "bg-primary text-primary-foreground" : "bg-background hover:bg-muted text-muted-foreground"
            }`}
          >
            <LayoutGrid className="h-3.5 w-3.5" />
            Board
          </button>
          <button
            type="button"
            onClick={() => setView("list")}
            className={`flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium border-l transition-colors ${
              view === "list" ? "bg-primary text-primary-foreground" : "bg-background hover:bg-muted text-muted-foreground"
            }`}
          >
            <List className="h-3.5 w-3.5" />
            List
          </button>
        </div>
      </div>

      {activeFilterCount > 0 && (
        <div className="shrink-0">
          <FilterChips filters={filterDefs} onClearAll={clearFilters} />
        </div>
      )}

      {/* Content */}
      {view === "board" ? (
        <div className="flex-1 min-h-0 overflow-hidden">
          <DealBoard
            key={selectedPipelineId}
            stages={stages}
            deals={filteredDeals}
            role={role}
            tenantId={tenantId}
            onRefresh={handleRefresh}
            onStagesChange={setStages}
            onDealsChange={setDeals}
          />
        </div>
      ) : (
        <div className="flex-1 min-h-0 overflow-y-auto">
          <DealsTable deals={filteredDeals} stages={stages} />
        </div>
      )}

      <AddDealSheet
        open={addOpen}
        onOpenChange={setAddOpen}
        stages={stages}
        role={role}
        pipelineId={selectedPipelineId}
        onSuccess={handleDealCreated}
      />
    </div>
  );
}
