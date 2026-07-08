"use client";

import { useState, useCallback, useRef, useMemo, useEffect } from "react";
import {
  DndContext,
  DragOverlay,
  DragStartEvent,
  DragOverEvent,
  DragEndEvent,
  PointerSensor,
  useSensor,
  useSensors,
  closestCorners,
} from "@dnd-kit/core";
import { createClient } from "@/lib/supabase/client";
import type { PipelineLead, PipelineStage, UserRole } from "@/types/database";
import { PipelineColumn } from "./PipelineColumn";
import { LeadCard } from "./LeadCard";
import { toast } from "sonner";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from "@/components/ui/select";
import { FilterMenu, FilterChips, type FilterDef } from "@/components/ui/filter-menu";
import {
  Search,
  Users2,
  Globe,
  ArrowUpDown,
  Download,
  Calendar,
  Plus,
  Briefcase,
} from "lucide-react";
import { PROSPECT_INDUSTRIES } from "@/industries/it-agency/leads/prospect-industries";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { AddLeadSheet } from "@/components/dashboard/add-lead-sheet";
import type { TenantEntity } from "@/types/database";

interface TeamMemberData {
  user_id: string;
  email: string;
  role: string;
  name: string;
}

interface PipelineBoardProps {
  stages: PipelineStage[];
  leads: PipelineLead[];
  role: UserRole;
  userId: string;
  tenantId: string;
  pipelineId?: string;
  teamMembersData?: TeamMemberData[];
  entities?: TenantEntity[];
  entityLabel?: string;
  industryId?: string | null;
  /** Position-derived permissions (source of truth). Fall back to legacy `role` if omitted. */
  canEditLeads?: boolean;
  restrictToSelf?: boolean;
}

interface TeamMember {
  user_id: string;
  email: string;
  name?: string | null;
}

type ColumnsState = Record<string, PipelineLead[]>;
type SortField = "created" | "updated" | "name" | "email";
type SortDirection = "asc" | "desc";

function groupByStage(
  leads: PipelineLead[],
  stages: PipelineStage[]
): ColumnsState {
  const columns: ColumnsState = {};
  for (const stage of stages) {
    columns[stage.id] = [];
  }
  for (const lead of leads) {
    if (lead.stage_id && columns[lead.stage_id]) {
      columns[lead.stage_id].push(lead);
    }
  }
  return columns;
}

function findLeadColumn(
  columns: ColumnsState,
  leadId: string
): string | null {
  for (const [stageId, leads] of Object.entries(columns)) {
    if (leads.some((l) => l.id === leadId)) {
      return stageId;
    }
  }
  return null;
}

function sortLeads(leads: PipelineLead[], sortField: SortField, sortDirection: SortDirection): PipelineLead[] {
  return [...leads].sort((a, b) => {
    let comparison = 0;
    switch (sortField) {
      case "updated":
        comparison = new Date(a.updated_at).getTime() - new Date(b.updated_at).getTime();
        break;
      case "created":
        comparison = new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
        break;
      case "name":
        const nameA = `${a.first_name || ""} ${a.last_name || ""}`.trim().toLowerCase();
        const nameB = `${b.first_name || ""} ${b.last_name || ""}`.trim().toLowerCase();
        comparison = nameA.localeCompare(nameB);
        break;
      case "email":
        const emailA = (a.email || "").toLowerCase();
        const emailB = (b.email || "").toLowerCase();
        comparison = emailA.localeCompare(emailB);
        break;
      default:
        comparison = 0;
    }
    return sortDirection === "asc" ? comparison : -comparison;
  });
}

export function PipelineBoard({
  stages,
  leads,
  role,
  userId,
  tenantId,
  pipelineId,
  teamMembersData = [],
  entities = [],
  entityLabel,
  industryId,
  canEditLeads,
  restrictToSelf,
}: PipelineBoardProps) {
  const [mounted, setMounted] = useState(false);
  const [columns, setColumns] = useState<ColumnsState>(() =>
    groupByStage(leads, stages)
  );
  const [activeId, setActiveId] = useState<string | null>(null);
  const prevColumnsRef = useRef<ColumnsState | null>(null);

  // Filter States
  const [searchQuery, setSearchQuery] = useState("");
  const [counselorFilter, setCounselorFilter] = useState<string>("all");
  const [sourceFilter, setSourceFilter] = useState<string>("all");
  const [createdFilter, setCreatedFilter] = useState<string>("all");
  const [industryFilter, setIndustryFilter] = useState<string>("all");
  const [sortField, setSortField] = useState<SortField>("updated");
  const [sortDirection, setSortDirection] = useState<SortDirection>("desc");
  const [teamMembers, setTeamMembers] = useState<TeamMember[]>([]);
  const [addLeadOpen, setAddLeadOpen] = useState(false);

  const isAdmin = role === "admin" || role === "owner";
  // Position is the source of truth: gate on resolved permissions, not the legacy `role`
  // string (a Branch Manager carries role="viewer" but canEditLeads=true). Fall back to
  // role only when the permission props aren't supplied.
  const canEdit = canEditLeads ?? role !== "viewer";
  const restrictSelf = restrictToSelf ?? role === "counselor";
  const canCreateLead = canEdit;

  // Fix hydration mismatch: DnD-kit and Radix Select generate random IDs
  useEffect(() => {
    setMounted(true);
  }, []);

  // Sync columns state when stages prop changes (e.g. after adding/removing stages)
  useEffect(() => {
    setColumns((prev) => {
      const next = { ...prev };
      // Add new stages that don't exist in columns yet
      for (const stage of stages) {
        if (!next[stage.id]) {
          next[stage.id] = [];
        }
      }
      // Remove stages that no longer exist
      for (const stageId of Object.keys(next)) {
        if (!stages.find((s) => s.id === stageId)) {
          // Move orphaned leads to the first stage
          const orphanedLeads = next[stageId];
          delete next[stageId];
          if (orphanedLeads.length > 0 && stages.length > 0) {
            next[stages[0].id] = [...(next[stages[0].id] || []), ...orphanedLeads];
          }
        }
      }
      return next;
    });
  }, [stages]);

  // Realtime Subscription
  useEffect(() => {
    const supabase = createClient();

    const channel = supabase
      .channel(`pipeline-${tenantId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "leads",
          filter: `tenant_id=eq.${tenantId}`,
        },
        (payload) => {
          const { eventType, new: newRecord, old: oldRecord } = payload;

          setColumns((prev) => {
            const next = { ...prev };
            const updatedLead = newRecord as PipelineLead;
            const leadId = (updatedLead?.id || (oldRecord as PipelineLead)?.id) as string;

            // 1. Find and remove the lead from its current position
            let existingLead: PipelineLead | undefined;
            for (const stageId in next) {
              const foundIdx = next[stageId].findIndex((l) => l.id === leadId);
              if (foundIdx !== -1) {
                existingLead = next[stageId][foundIdx];
                next[stageId] = next[stageId].filter((l) => l.id !== leadId);
                break;
              }
            }

            // 2. Handle the event
            if (eventType === "DELETE" || (updatedLead && updatedLead.deleted_at)) {
              // Already removed from next above
              return { ...next };
            }

            if (eventType === "INSERT" || eventType === "UPDATE") {
              const stageId = updatedLead.stage_id;
              if (stageId && next[stageId]) {
                const mergedLead: PipelineLead = {
                  ...updatedLead,
                  checklist_total: existingLead?.checklist_total || 0,
                  checklist_completed: existingLead?.checklist_completed || 0,
                };
                // Add to top of the column
                next[stageId] = [mergedLead, ...next[stageId]];
              }
            }

            return { ...next };
          });
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [tenantId]);

  // Fetch team members for filtering (admin only)
  useEffect(() => {
    if (isAdmin) {
      fetch("/api/v1/team")
        .then(res => res.json())
        .then(json => setTeamMembers(json.data || []))
        .catch(() => {});
    }
  }, [isAdmin]);

  // Derived unique sources for filter
  const sources = useMemo(() => {
    const s = new Set<string>();
    leads.forEach(l => {
      if (l.intake_source) s.add(l.intake_source);
    });
    return Array.from(s).sort();
  }, [leads]);

  // Apply filters to columns
  const filteredColumns = useMemo(() => {
    const filtered: ColumnsState = {};
    const query = searchQuery.toLowerCase();
    const now = Date.now();

    Object.entries(columns).forEach(([stageId, leadList]) => {
      const filteredLeads = leadList.filter(l => {
        const matchesSearch = !query ||
          l.first_name?.toLowerCase().includes(query) ||
          l.last_name?.toLowerCase().includes(query) ||
          l.email?.toLowerCase().includes(query) ||
          l.phone?.toLowerCase().includes(query);

        const matchesCounselor = counselorFilter === "all" ||
          (counselorFilter === "unassigned" ? !l.assigned_to : l.assigned_to === counselorFilter);
        const matchesSource = sourceFilter === "all" || l.intake_source === sourceFilter;

        const matchesIndustry = industryFilter === "all" ||
          (industryFilter === "__none__" ? !l.prospect_industry : l.prospect_industry === industryFilter);

        // Created date filter
        let matchesCreated = true;
        if (createdFilter !== "all") {
          const createdAt = new Date(l.created_at).getTime();
          const dayMs = 24 * 60 * 60 * 1000;
          switch (createdFilter) {
            case "today":
              matchesCreated = now - createdAt < dayMs;
              break;
            case "week":
              matchesCreated = now - createdAt < 7 * dayMs;
              break;
            case "month":
              matchesCreated = now - createdAt < 30 * dayMs;
              break;
          }
        }

        return matchesSearch && matchesCounselor && matchesSource && matchesIndustry && matchesCreated;
      });

      // Apply sorting
      filtered[stageId] = sortLeads(filteredLeads, sortField, sortDirection);
    });
    return filtered;
  }, [columns, searchQuery, counselorFilter, sourceFilter, createdFilter, industryFilter, sortField, sortDirection]);

  const clearFilters = () => {
    setSearchQuery("");
    setCounselorFilter("all");
    setSourceFilter("all");
    setCreatedFilter("all");
    setIndustryFilter("all");
  };

  const activeFiltersCount = [
    searchQuery !== "",
    counselorFilter !== "all",
    sourceFilter !== "all",
    createdFilter !== "all",
    industryFilter !== "all",
  ].filter(Boolean).length;

  // Export to CSV
  const handleExport = () => {
    const allLeads = Object.values(filteredColumns).flat();
    if (allLeads.length === 0) {
      toast.error("No leads to export");
      return;
    }

    const headers = ["Name", "Email", "Phone", "Country", "Stage", "Created", "Status"];
    const stageMap = new Map(stages.map(s => [s.id, s.name]));

    const rows = allLeads.map(lead => [
      `${lead.first_name || ""} ${lead.last_name || ""}`.trim(),
      lead.email || "",
      lead.phone || "",
      lead.country || "",
      lead.stage_id ? stageMap.get(lead.stage_id) || "" : "",
      new Date(lead.created_at).toLocaleDateString(),
      lead.status || ""
    ]);

    const csv = [headers, ...rows].map(row => row.map(cell => `"${cell}"`).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `pipeline-export-${new Date().toISOString().split("T")[0]}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success(`Exported ${allLeads.length} leads`);
  };

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: { distance: 5 },
    })
  );

  const stageMap = new Map(stages.map((s) => [s.id, s]));

  // Remove a lead from the board after it's moved to another pipeline
  const handleLeadMovedToPipeline = useCallback((leadId: string) => {
    setColumns((prev) => {
      const next = { ...prev };
      for (const stageId of Object.keys(next)) {
        next[stageId] = next[stageId].filter((l) => l.id !== leadId);
      }
      return next;
    });
  }, []);

  const canDragLead = useCallback(
    (lead: PipelineLead): boolean => {
      if (!canEdit) return false;
      if (restrictSelf && lead.assigned_to !== userId) return false;
      return true;
    },
    [canEdit, restrictSelf, userId]
  );

  const activeLead =
    activeId
      ? Object.values(columns)
          .flat()
          .find((l) => l.id === activeId) ?? null
      : null;

  function handleDragStart(event: DragStartEvent) {
    const id = event.active.id as string;
    const lead = Object.values(columns)
      .flat()
      .find((l) => l.id === id);

    if (!lead || !canDragLead(lead)) {
      return;
    }
    setActiveId(id);
    prevColumnsRef.current = JSON.parse(JSON.stringify(columns));
  }

  function handleDragOver(event: DragOverEvent) {
    const { active, over } = event;
    if (!over || !activeId) return;

    const activeLeadId = active.id as string;
    const overId = over.id as string;

    const fromCol = findLeadColumn(columns, activeLeadId);
    const toCol = stageMap.has(overId)
      ? overId
      : findLeadColumn(columns, overId);

    if (!fromCol || !toCol || fromCol === toCol) return;

    setColumns((prev) => {
      const from = prev[fromCol].filter((l) => l.id !== activeLeadId);
      const lead = prev[fromCol].find((l) => l.id === activeLeadId);
      if (!lead) return prev;

      const to = [...prev[toCol!]];
      const overIndex = to.findIndex((l) => l.id === overId);
      if (overIndex >= 0) {
        to.splice(overIndex, 0, lead);
      } else {
        to.push(lead);
      }

      return { ...prev, [fromCol]: from, [toCol!]: to };
    });
  }

  async function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    setActiveId(null);

    if (!over) {
      // Dropped outside — revert
      if (prevColumnsRef.current) {
        setColumns(prevColumnsRef.current);
      }
      prevColumnsRef.current = null;
      return;
    }

    const leadId = active.id as string;
    const overId = over.id as string;

    const targetCol = stageMap.has(overId)
      ? overId
      : findLeadColumn(columns, overId);

    if (!targetCol) {
      if (prevColumnsRef.current) {
        setColumns(prevColumnsRef.current);
      }
      prevColumnsRef.current = null;
      return;
    }

    const lead = Object.values(prevColumnsRef.current || columns)
      .flat()
      .find((l) => l.id === leadId);

    if (!lead || lead.stage_id === targetCol) {
      prevColumnsRef.current = null;
      return;
    }

    try {
      const res = await fetch(`/api/v1/leads/${leadId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ stage_id: targetCol }),
      });

      if (!res.ok) {
        throw new Error("Failed to update stage");
      }

      setColumns((prev) => {
        const updated = { ...prev };
        for (const stageId of Object.keys(updated)) {
          updated[stageId] = updated[stageId].map((l) =>
            l.id === leadId ? { ...l, stage_id: targetCol } : l
          );
        }
        return updated;
      });
    } catch {
      // Revert on failure
      if (prevColumnsRef.current) {
        setColumns(prevColumnsRef.current);
      }
      toast.error("Failed to move lead. Please try again.");
    }

    prevColumnsRef.current = null;
  }

  // Show loading state until mounted to prevent hydration mismatch
  if (!mounted) {
    return (
      <div className="flex flex-col flex-1 min-h-0 gap-1">
        {/* Toolbar skeleton */}
        <div className="shrink-0 bg-card p-3">
          <div className="flex items-center gap-3">
            <div className="h-7 w-60 bg-muted rounded animate-pulse" />
            <div className="h-7 w-32 bg-muted rounded animate-pulse" />
            <div className="flex-1" />
            <div className="h-7 w-24 bg-muted rounded animate-pulse" />
          </div>
        </div>
        {/* Columns skeleton */}
        <div className="flex-1 min-h-0 overflow-hidden">
          <div className="flex gap-4 overflow-x-auto pb-4 h-full">
            {stages.map((stage) => (
              <div
                key={stage.id}
                className="flex-shrink-0 w-80 bg-muted/30 rounded-lg animate-pulse h-full"
              >
                <div className="h-10 bg-muted rounded-t-lg" />
                <div className="p-3 space-y-3">
                  <div className="h-40 bg-muted/50 rounded-xl" />
                  <div className="h-40 bg-muted/50 rounded-xl" />
                </div>
                <div className="h-12 bg-muted rounded-b-lg" />
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  const filterDefs: FilterDef[] = [
    ...(isAdmin
      ? [
          {
            id: "counselor",
            label: "All Counselors",
            icon: <Users2 className="h-3.5 w-3.5" />,
            multiple: false,
            defaultValue: "all",
            value: counselorFilter,
            onChange: setCounselorFilter,
            options: [
              { value: "all", label: "All Counselors", description: "Show leads from everyone" },
              { value: "unassigned", label: "Unassigned", description: "Leads not assigned yet" },
              ...teamMembers.map((m) => ({
                value: m.user_id,
                label: m.name || m.email.split("@")[0],
                description: m.email,
              })),
            ],
          } satisfies FilterDef,
        ]
      : []),
    ...(sources.length > 0
      ? [
          {
            id: "source",
            label: "All Sources",
            icon: <Globe className="h-3.5 w-3.5" />,
            multiple: false,
            defaultValue: "all",
            value: sourceFilter,
            onChange: setSourceFilter,
            options: [
              { value: "all", label: "All Sources", description: "Show leads from all sources" },
              ...sources.map((s) => ({
                value: s,
                label: s,
                description: `Leads from ${s}`,
              })),
            ],
          } satisfies FilterDef,
        ]
      : []),
    ...(industryId === "it_agency"
      ? [
          {
            id: "industry",
            label: "All Industries",
            icon: <Briefcase className="h-3.5 w-3.5" />,
            multiple: false,
            defaultValue: "all",
            value: industryFilter,
            onChange: setIndustryFilter,
            options: [
              { value: "all", label: "All Industries", description: "Show all leads" },
              ...PROSPECT_INDUSTRIES.map((ind) => ({
                value: ind.value,
                label: ind.label,
                description: `${ind.label} leads`,
              })),
              { value: "__none__", label: "Unspecified", description: "Leads with no industry set" },
            ],
          } satisfies FilterDef,
        ]
      : []),
    {
      id: "created",
      label: "Any time",
      icon: <Calendar className="h-3.5 w-3.5" />,
      multiple: false,
      searchable: false,
      defaultValue: "all",
      value: createdFilter,
      onChange: setCreatedFilter,
      options: [
        { value: "all", label: "Any time", description: "All time periods" },
        { value: "today", label: "Today", description: "Last 24 hours" },
        { value: "week", label: "Last 7 days", description: "Past week" },
        { value: "month", label: "Last 30 days", description: "Past month" },
      ],
    } satisfies FilterDef,
  ];

  return (
    <div className="flex flex-col flex-1 min-h-0 gap-1">
      {/* Enhanced Toolbar */}
      <div className="shrink-0 bg-card">
        {/* Top Row: Search + Actions */}
        <div className="flex flex-wrap items-center gap-3 p-3">
          {/* Lead count */}
          <div className="text-sm font-medium text-muted-foreground shrink-0">
            {Object.values(filteredColumns).flat().length} Leads
          </div>

          {/* Search */}
          <div className="relative w-60">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3 w-3 text-gray-400" />
            <input
              type="text"
              placeholder="Search leads..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full h-7 pl-7 pr-3 rounded-md border border-gray-300 bg-white text-xs text-gray-600 placeholder:text-gray-400 outline-none focus:ring-1 focus:ring-ring"
            />
          </div>

          <div className="flex-1" />

          <FilterMenu filters={filterDefs} activeCount={activeFiltersCount} onClearAll={clearFilters} />

          {/* Sort */}
          <Popover>
            <PopoverTrigger asChild>
              <button
                type="button"
                className="inline-flex items-center gap-1.5 h-7 px-2.5 text-xs font-medium rounded-md border transition-colors border-gray-300 bg-white text-gray-600 hover:bg-[#0000170b]"
              >
                <ArrowUpDown className="h-3 w-3 shrink-0" />
                Sort
              </button>
            </PopoverTrigger>
            <PopoverContent align="end" className="w-72 p-4">
              <div className="space-y-4">
                <p className="text-sm font-medium">Sort by</p>
                <div className="flex items-center gap-2">
                  {/* Field selector */}
                  <Select value={sortField} onValueChange={(v) => setSortField(v as SortField)}>
                    <SelectTrigger className="flex-1 h-9">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="created">Date created</SelectItem>
                      <SelectItem value="updated">Last updated</SelectItem>
                      <SelectItem value="name">Name</SelectItem>
                      <SelectItem value="email">Email</SelectItem>
                    </SelectContent>
                  </Select>
                  {/* Direction toggle */}
                  <div className="flex rounded-md border shrink-0">
                    <button
                      type="button"
                      onClick={() => setSortDirection("desc")}
                      className={`px-3 py-2 text-xs font-medium transition-colors whitespace-nowrap ${
                        sortDirection === "desc"
                          ? "bg-primary text-primary-foreground"
                          : "bg-background hover:bg-muted"
                      }`}
                    >
                      Z→A
                    </button>
                    <button
                      type="button"
                      onClick={() => setSortDirection("asc")}
                      className={`px-3 py-2 text-xs font-medium transition-colors border-l whitespace-nowrap ${
                        sortDirection === "asc"
                          ? "bg-primary text-primary-foreground"
                          : "bg-background hover:bg-muted"
                      }`}
                    >
                      A→Z
                    </button>
                  </div>
                </div>
              </div>
            </PopoverContent>
          </Popover>

          {/* Export — admin/owner only */}
          {isAdmin && (
            <button
              type="button"
              onClick={handleExport}
              className="inline-flex items-center gap-1.5 h-7 px-2.5 text-xs font-medium rounded-md border transition-colors border-gray-300 bg-white text-gray-600 hover:bg-[#0000170b]"
            >
              <Download className="h-3 w-3 shrink-0" />
              Export
            </button>
          )}

          {/* Add Lead Button */}
          {canCreateLead && (
            <button
              type="button"
              onClick={() => setAddLeadOpen(true)}
              className="inline-flex items-center gap-1.5 h-7 px-2.5 text-xs font-medium rounded-md transition-colors bg-[#0f0f10] text-white hover:bg-[#0f0f10]/90"
            >
              <Plus className="h-3 w-3 shrink-0" />
              Add Lead
            </button>
          )}
        </div>

        {activeFiltersCount > 0 && <FilterChips filters={filterDefs} onClearAll={clearFilters} />}
      </div>

      {/* Kanban Board */}
      <div className="flex-1 min-h-0 overflow-hidden">
        <DndContext
          sensors={sensors}
          collisionDetection={closestCorners}
          onDragStart={handleDragStart}
          onDragOver={handleDragOver}
          onDragEnd={handleDragEnd}
        >
          <div className="flex gap-4 overflow-x-auto pb-4 h-full scrollbar-thin scrollbar-thumb-muted-foreground/20 hover:scrollbar-thumb-muted-foreground/40">
            {stages.map((stage) => (
              <PipelineColumn
                key={stage.id}
                stage={stage}
                leads={filteredColumns[stage.id] || []}
                canDragLead={canDragLead}
                pipelineId={pipelineId}
                onMovedToPipeline={handleLeadMovedToPipeline}
              />
            ))}
          </div>

          <DragOverlay>
            {activeLead ? (
              <LeadCard
                lead={activeLead}
                disabled
              />
            ) : null}
          </DragOverlay>
        </DndContext>
      </div>

      {/* Add Lead Sheet */}
      {canCreateLead && (
        <AddLeadSheet
          open={addLeadOpen}
          onOpenChange={setAddLeadOpen}
          tenantId={tenantId}
          pipelineId={pipelineId}
          stages={stages}
          teamMembers={teamMembersData}
          entities={entities}
          entityLabel={entityLabel}
          role={role}
          currentUserId={userId}
          industryId={industryId}
        />
      )}
    </div>
  );
}
