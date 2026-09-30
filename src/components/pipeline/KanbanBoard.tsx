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
import type { PipelineLead, PipelineStage, UserRole } from "@/types/database";
import { PipelineColumn } from "./PipelineColumn";
import { LeadCard } from "./LeadCard";
import { toast } from "sonner";
import { useKanbanColumns, type KanbanColumnDef, type KanbanColumnsState } from "./use-kanban-columns";
import {
  buildKanbanColumnParams,
  resolveKanbanColumnParams,
  type KanbanFilterState,
  type SortField,
  type SortDirection,
} from "./kanban-column-params";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue
} from "@/components/ui/select";
import { FilterMenu, FilterChips, type FilterDef } from "@/components/ui/filter-menu";
import { TOOLBAR_BTN, TOOLBAR_PRIMARY_BTN, TOOLBAR_SEARCH_INPUT } from "@/components/dashboard/leads/toolbar-btn";
import {
  Search,
  Users2,
  Globe,
  ArrowUpDown,
  Download,
  Calendar,
  Plus,
  Briefcase,
  Tag,
  UserPlus,
  LayoutList,
  Settings2,
} from "lucide-react";
import { PROSPECT_INDUSTRIES } from "@/industries/it-agency/leads/prospect-industries";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { AddLeadSheet } from "@/components/dashboard/add-lead-sheet";
import type { TenantEntity } from "@/types/database";
import { countSuffix, isOfferedByCount, sortByCountDesc } from "@/lib/leads/facet-labels";

interface TeamMemberData {
  user_id: string;
  email: string;
  role: string;
  name: string;
}

interface KanbanBoardProps {
  /** "list": columns are (list, status) — the lead-lists Kanban view, one status
   * within one list. "stage": columns are one stage_id each — the classic
   * single-pipeline board (no lead-lists feature), using the Phase 1 `?stage=`
   * filter. The only real behavioral fork in this component; see the identity/
   * facet branches below. */
  mode: "list" | "stage";
  stages: PipelineStage[];
  /** Required (and meaningful) only in mode "list" — scopes every per-column
   * /api/v1/leads request (KANBAN-PAGINATION-BRIEF §2a). Column identity itself is
   * stage.slug (`status`) within this list. */
  listSlug?: string;
  /** SSR-seeded page 1 + true count per column, keyed by stage.id. */
  initialColumns: Record<string, { cards: PipelineLead[]; total: number }>;
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
  isTeamScoped?: boolean;
  leadCollaborators?: Record<string, string[]>;
  formMap?: Record<string, string>;
  /** mode "list" only — renders a "List view" link in the toolbar, in the same slot
   * the list view's own "Kanban view" button occupies, so the two toolbars match. */
  listViewHref?: string;
  /** mode "list" only — renders a "Manage stages"/"Manage statuses" button (admin-only,
   * caller gates that) in the same slot the list view's "Edit columns" button occupies. */
  onManageStages?: () => void;
  manageStagesLabel?: string;
}

function findLeadColumn(columns: KanbanColumnsState, leadId: string): string | null {
  for (const [stageId, col] of Object.entries(columns)) {
    if (col.cards.some((l) => l.id === leadId)) return stageId;
  }
  return null;
}

export function KanbanBoard({
  mode,
  stages,
  listSlug,
  initialColumns,
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
  isTeamScoped = false,
  leadCollaborators = {},
  formMap = {},
  listViewHref,
  onManageStages,
  manageStagesLabel = "Manage stages",
}: KanbanBoardProps) {
  const [mounted, setMounted] = useState(false);
  const [activeId, setActiveId] = useState<string | null>(null);
  const prevColumnsRef = useRef<KanbanColumnsState | null>(null);

  // Filter States — drive server requests (KANBAN-PAGINATION-BRIEF §3.4), not an
  // in-memory .filter() over a fully-loaded array.
  const [searchQuery, setSearchQuery] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [counselorFilter, setCounselorFilter] = useState<string[]>([]);
  const [sourceFilter, setSourceFilter] = useState<string[]>([]);
  const [collaboratorFilter, setCollaboratorFilter] = useState<string[]>([]);
  const [tagFilter, setTagFilter] = useState<string>("all");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [formFilter, setFormFilter] = useState<string>("all");
  const [createdFilter, setCreatedFilter] = useState<string>("all");
  const [industryFilter, setIndustryFilter] = useState<string>("all");
  const [sortField, setSortField] = useState<SortField>("updated");
  const [sortDirection, setSortDirection] = useState<SortDirection>("desc");
  const [addLeadOpen, setAddLeadOpen] = useState(false);

  const isAdmin = role === "admin" || role === "owner";
  const canEdit = canEditLeads ?? role !== "viewer";
  const restrictSelf = restrictToSelf ?? role === "staff";
  const canCreateLead = canEdit;

  useEffect(() => {
    setMounted(true);
  }, []);

  // Debounce search 300ms — every keystroke would otherwise fire N (one per column)
  // server requests (mirrors leads-table.tsx's debouncedSearch).
  const searchDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current);
    searchDebounceRef.current = setTimeout(() => setDebouncedSearch(searchQuery), 300);
    return () => {
      if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current);
    };
  }, [searchQuery]);

  // Per-column request params — status/stage filter is redundant-with/conflicting-
  // with a column's own identity (each column already IS one status or stage), so a
  // mismatched global statusFilter just skips that column's fetch (KANBAN-PAGINATION-
  // BRIEF §3.4) rather than sending two contradictory values. Extracted to
  // kanban-column-params.ts (pure, no React) so it's unit-testable without a
  // DOM/component-test harness, which this repo doesn't have.
  const filterState: KanbanFilterState = useMemo(
    () => ({
      listSlug: mode === "list" ? listSlug : undefined,
      sortField, sortDirection, debouncedSearch, counselorFilter, collaboratorFilter,
      sourceFilter, tagFilter, formFilter, createdFilter, industryFilter,
    }),
    [
      mode, listSlug, sortField, sortDirection, debouncedSearch, counselorFilter, collaboratorFilter,
      sourceFilter, tagFilter, formFilter, createdFilter, industryFilter,
    ],
  );

  const columnDefs = useMemo<KanbanColumnDef[]>(
    () =>
      stages.map((stage) => ({
        key: stage.id,
        params: resolveKanbanColumnParams(
          filterState,
          statusFilter,
          stage.slug,
          mode === "list" ? { status: stage.slug } : { stage: stage.id },
        ),
      })),
    [stages, statusFilter, filterState, mode],
  );

  const filterSignature = useMemo(
    () =>
      JSON.stringify([
        mode, listSlug, debouncedSearch, counselorFilter, sourceFilter, collaboratorFilter, tagFilter,
        statusFilter, formFilter, createdFilter, industryFilter, sortField, sortDirection,
      ]),
    [
      mode, listSlug, debouncedSearch, counselorFilter, sourceFilter, collaboratorFilter, tagFilter,
      statusFilter, formFilter, createdFilter, industryFilter, sortField, sortDirection,
    ],
  );

  const { columns, setColumns, loadMore } = useKanbanColumns(columnDefs, filterSignature, initialColumns);

  // Sync new/removed stages (e.g. after adding/removing a stage in settings).
  useEffect(() => {
    setColumns((prev) => {
      const next = { ...prev };
      let changed = false;
      for (const stage of stages) {
        if (!next[stage.id]) {
          next[stage.id] = { cards: [], loaded: 0, total: 0, page: 1, isLoadingMore: false };
          changed = true;
        }
      }
      for (const stageId of Object.keys(next)) {
        if (!stages.find((s) => s.id === stageId)) {
          const orphaned = next[stageId];
          delete next[stageId];
          changed = true;
          if (orphaned.cards.length > 0 && stages.length > 0) {
            const target = next[stages[0].id];
            next[stages[0].id] = {
              ...target,
              cards: [...target.cards, ...orphaned.cards],
              loaded: target.loaded + orphaned.cards.length,
              total: target.total + orphaned.total,
            };
          }
        }
      }
      return changed ? next : prev;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stages]);

  // Currently-loaded cards across every column — used for filter option lists whose
  // exact counts would need a new server aggregate (out of KANBAN-PAGINATION-BRIEF's
  // scope: "do not build new endpoints"). Counts below are therefore approximate —
  // they reflect loaded cards only, not the column's full total — same tradeoff as
  // the Export button below.
  const loadedCards = useMemo(() => Object.values(columns).flatMap((c) => c.cards), [columns]);

  const counselors = useMemo(
    () => teamMembersData.map((m) => [m.user_id, m.email] as const),
    [teamMembersData]
  );
  const memberNames = useMemo(
    () => Object.fromEntries(teamMembersData.map((m) => [m.user_id, m.name])),
    [teamMembersData]
  );

  const hasMultipleForms = Object.keys(formMap).length > 1;
  const formEntries = useMemo(() => Object.entries(formMap), [formMap]);

  const statusFilterOptions = useMemo(
    () => [
      { value: "all", label: "All Status", description: "Show all leads" },
      ...stages.map((s) => ({ value: s.slug, label: s.name })),
    ],
    [stages]
  );

  // Server-computed Source / Assigned-To / Collaborator facets, BOTH modes. Assigned-To and
  // Collaborator counts are the list's own query run once per person (route.ts, FACET-COUNT-
  // CONSISTENCY), so a number beside a name is exactly the row count that name gives — under
  // the same Stage/Status/List/pipeline scope the columns use. The old loaded-cards-only
  // approximation (which is what made these numbers disagree with the board) is gone: a facet
  // the server can't count comes back `null` and the option is shown WITHOUT a number.
  //
  // The request mirrors the columns' filter params, plus what the columns get from their
  // identity/toolbar rather than from the params: the global Status filter (a Status filter
  // hides every other column, so counts must too) and — for the classic board — the pipeline
  // (its columns are stage ids; the board-level request has no single stage to name).
  // Requesting all three in one round-trip always gets route.ts's multi-facet shape.
  type FacetOptions = { name: string; count: number }[] | null;
  const [sourceFacet, setSourceFacet] = useState<FacetOptions>(null);
  const [assigneeFacet, setAssigneeFacet] = useState<FacetOptions>(null);
  const [collaboratorFacet, setCollaboratorFacet] = useState<FacetOptions>(null);
  // Source values are free text only the server can enumerate: keep the last list when a
  // later response can't count them, so the picker stays usable (uncounted).
  const [lastSourceNames, setLastSourceNames] = useState<string[]>([]);
  const facetPipelineId = mode === "stage" ? (pipelineId ?? stages[0]?.pipeline_id) : undefined;
  useEffect(() => {
    const params = buildKanbanColumnParams(filterState, {});
    if (statusFilter !== "all") params.set("status", statusFilter);
    if (facetPipelineId) params.set("pipeline", facetPipelineId);
    params.set("facets", "source,assignee,collaborator");
    const controller = new AbortController();
    fetch(`/api/v1/leads?${params.toString()}`, { signal: controller.signal })
      .then((res) => res.json())
      .then((body: {
        data?: {
          facets?: {
            source?: { options: { name: string; count: number }[] } | null;
            assignee?: { options: { name: string; count: number }[] } | null;
            collaborator?: { options: { name: string; count: number }[] } | null;
          } | null;
        };
      }) => {
        if (controller.signal.aborted) return;
        const f = body.data?.facets;
        if (!f) {
          setSourceFacet(null);
          setAssigneeFacet(null);
          setCollaboratorFacet(null);
          return;
        }
        // Per-facet null = "no faithful number" → keep null (uncounted), never [] (blank).
        const pick = (v: { options: { name: string; count: number }[] } | null | undefined) =>
          v === null || v === undefined ? null : v.options;
        if (f.source) setLastSourceNames(f.source.options.map((o) => o.name));
        setSourceFacet(pick(f.source));
        setAssigneeFacet(pick(f.assignee));
        setCollaboratorFacet(pick(f.collaborator));
      })
      .catch((err: unknown) => {
        if (controller.signal.aborted) return;
        console.error("Failed to load source/assignee/collaborator facets", err);
      });
    return () => controller.abort();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, listSlug, facetPipelineId, statusFilter, debouncedSearch, counselorFilter, sourceFilter, collaboratorFilter, tagFilter, formFilter, createdFilter, industryFilter]);

  const sourceOptions = useMemo<{ name: string; count: number | null }[]>(
    () => (sourceFacet ?? lastSourceNames.map((name) => ({ name, count: null }))),
    [sourceFacet, lastSourceNames],
  );
  const assigneeCounts = useMemo<Map<string, number> | null>(
    () => (assigneeFacet ? new Map(assigneeFacet.map((o) => [o.name, o.count])) : null),
    [assigneeFacet],
  );
  const collaboratorCounts = useMemo<Map<string, number> | null>(
    () => (collaboratorFacet ? new Map(collaboratorFacet.map((o) => [o.name, o.count])) : null),
    [collaboratorFacet],
  );

  const clearFilters = () => {
    setSearchQuery("");
    setCounselorFilter([]);
    setSourceFilter([]);
    setCollaboratorFilter([]);
    setTagFilter("all");
    setStatusFilter("all");
    setFormFilter("all");
    setCreatedFilter("all");
    setIndustryFilter("all");
  };

  const activeFiltersCount = [
    searchQuery !== "",
    counselorFilter.length > 0,
    sourceFilter.length > 0,
    collaboratorFilter.length > 0,
    tagFilter !== "all",
    statusFilter !== "all",
    formFilter !== "all",
    createdFilter !== "all",
    industryFilter !== "all",
  ].filter(Boolean).length;

  // Export to CSV — covers currently-LOADED cards only (see loadedCards comment).
  // Exporting the true full filtered set would need a dedicated export endpoint;
  // out of KANBAN-PAGINATION-BRIEF's scope ("do not build new endpoints").
  const handleExport = () => {
    if (loadedCards.length === 0) {
      toast.error("No leads to export");
      return;
    }

    const headers = ["Name", "Email", "Phone", "Country", "Stage", "Created", "Status"];
    const stageMap = new Map(stages.map(s => [s.id, s.name]));

    const rows = loadedCards.map(lead => [
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
    toast.success(`Exported ${loadedCards.length} loaded lead${loadedCards.length !== 1 ? "s" : ""}`);
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
      const stageId = findLeadColumn(prev, leadId);
      if (!stageId) return prev;
      const col = prev[stageId];
      const cards = col.cards.filter((l) => l.id !== leadId);
      return { ...prev, [stageId]: { ...col, cards, loaded: cards.length, total: Math.max(0, col.total - 1) } };
    });
  }, [setColumns]);

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
      ? Object.values(columns).flatMap((c) => c.cards).find((l) => l.id === activeId) ?? null
      : null;

  function handleDragStart(event: DragStartEvent) {
    const id = event.active.id as string;
    const lead = Object.values(columns).flatMap((c) => c.cards).find((l) => l.id === id);

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
    const toCol = stageMap.has(overId) ? overId : findLeadColumn(columns, overId);

    if (!fromCol || !toCol || fromCol === toCol) return;

    setColumns((prev) => {
      const fromState = prev[fromCol];
      const toState = prev[toCol];
      const lead = fromState.cards.find((l) => l.id === activeLeadId);
      if (!lead) return prev;

      const fromCards = fromState.cards.filter((l) => l.id !== activeLeadId);
      const toCards = [...toState.cards];
      const overIndex = toCards.findIndex((l) => l.id === overId);
      if (overIndex >= 0) {
        toCards.splice(overIndex, 0, lead);
      } else {
        toCards.push(lead);
      }

      return {
        ...prev,
        [fromCol]: { ...fromState, cards: fromCards, loaded: fromCards.length, total: Math.max(0, fromState.total - 1) },
        [toCol]: { ...toState, cards: toCards, loaded: toCards.length, total: toState.total + 1 },
      };
    });
  }

  async function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    setActiveId(null);

    if (!over) {
      if (prevColumnsRef.current) setColumns(prevColumnsRef.current);
      prevColumnsRef.current = null;
      return;
    }

    const leadId = active.id as string;
    const overId = over.id as string;

    const targetCol = stageMap.has(overId) ? overId : findLeadColumn(columns, overId);

    if (!targetCol) {
      if (prevColumnsRef.current) setColumns(prevColumnsRef.current);
      prevColumnsRef.current = null;
      return;
    }

    const lead = Object.values(prevColumnsRef.current || columns).flatMap((c) => c.cards).find((l) => l.id === leadId);

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

      // handleDragOver already moved the card + adjusted totals — just stamp the
      // persisted stage_id onto the card object in its (already correct) column.
      setColumns((prev) => {
        const col = prev[targetCol];
        if (!col) return prev;
        return {
          ...prev,
          [targetCol]: {
            ...col,
            cards: col.cards.map((l) => (l.id === leadId ? { ...l, stage_id: targetCol } : l)),
          },
        };
      });
    } catch {
      if (prevColumnsRef.current) setColumns(prevColumnsRef.current);
      toast.error("Failed to move lead. Please try again.");
    }

    prevColumnsRef.current = null;
  }

  // Show loading state until mounted to prevent hydration mismatch
  if (!mounted) {
    return (
      <div className="flex flex-col flex-1 min-h-0 gap-1">
        {/* Toolbar skeleton */}
        <div className="shrink-0 p-3">
          <div className="flex items-center gap-3">
            <div className="h-7 w-60 bg-muted rounded animate-pulse" />
            <div className="h-7 w-32 bg-muted rounded animate-pulse" />
            <div className="flex-1" />
            <div className="h-7 w-24 bg-muted rounded animate-pulse" />
          </div>
        </div>
        {/* Columns skeleton */}
        <div className="flex-1 min-h-0 overflow-hidden">
          <div className="flex gap-4 overflow-x-auto pb-4 pl-3 h-full">
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

  const totalLoaded = Object.values(columns).reduce((sum, c) => sum + c.loaded, 0);
  // True total across columns under the active filters (same figures the column
  // headers show via col.total) — used to warn BEFORE the Export click when the
  // CSV will only cover the currently-loaded subset, not cards.length.
  const totalTrue = Object.values(columns).reduce((sum, c) => sum + c.total, 0);
  const exportIsPartial = totalLoaded < totalTrue;

  const filterDefs: FilterDef[] = [
    ...(sourceOptions.length > 0
      ? [
          {
            id: "source",
            label: "Source",
            icon: <Globe className="h-3.5 w-3.5" />,
            multiple: true,
            value: sourceFilter,
            onChange: setSourceFilter,
            options: sourceOptions.map((s) => ({
              value: s.name,
              label: s.count === null ? s.name : `${s.name} (${s.count.toLocaleString()})`,
              description: `Leads from ${s.name}`,
            })),
          } satisfies FilterDef,
        ]
      : []),
    ...(isAdmin || isTeamScoped
      ? [
          {
            id: "counselor",
            label: "Assigned To",
            icon: <Users2 className="h-3.5 w-3.5" />,
            multiple: true,
            value: counselorFilter,
            onChange: setCounselorFilter,
            options: [
              ...(isOfferedByCount(assigneeCounts, "unassigned", counselorFilter.includes("unassigned"))
                ? [
                    {
                      value: "unassigned",
                      label: `Unassigned${countSuffix(assigneeCounts, "unassigned")}`,
                      description: "Leads not assigned yet",
                    },
                  ]
                : []),
              ...counselors
                .map(([uid, email]) => ({
                  value: uid,
                  label: `${memberNames[uid] || email.split("@")[0]}${countSuffix(assigneeCounts, uid)}`,
                  description: email,
                })),
            ],
          } satisfies FilterDef,
        ]
      : []),
    ...((isAdmin || isTeamScoped) && Object.keys(leadCollaborators).length > 0
      ? [
          {
            id: "collaborator",
            label: "Collaborators",
            icon: <UserPlus className="h-3.5 w-3.5" />,
            multiple: true,
            value: collaboratorFilter,
            onChange: setCollaboratorFilter,
            // Listed regardless of role — an owner/admin who is genuinely a
            // collaborator on some leads must be filterable here too (matches the
            // /leads Collaborators filter). Counts are exact (see the facet effect
            // above). EVERY team member is listed — a name never vanishes because the
            // active filters narrowed to zero; the count is just a label, biggest first.
            options: sortByCountDesc(
              counselors,
              collaboratorCounts,
              ([uid]) => uid,
              ([uid, email]) => memberNames[uid] || email,
            )
              .map(([uid, email]) => ({
                value: uid,
                label: `${memberNames[uid] || email.split("@")[0]}${countSuffix(collaboratorCounts, uid)}`,
                description: email,
              })),
          } satisfies FilterDef,
        ]
      : []),
    ...(industryId === "education_consultancy"
      ? [
          {
            id: "tag",
            label: "Tag",
            icon: <Tag className="h-3.5 w-3.5" />,
            value: tagFilter,
            onChange: setTagFilter,
            options: [
              { value: "all", label: "All Tags", description: "Show all leads" },
              { value: "student", label: "Student", description: "Student leads only" },
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
      label: "Date created",
      icon: <Calendar className="h-3.5 w-3.5" />,
      searchable: false,
      value: createdFilter,
      onChange: setCreatedFilter,
      options: [
        { value: "all", label: "Any time", description: "All time periods" },
        { value: "today", label: "Today", description: "Last 24 hours" },
        { value: "week", label: "Last 7 days", description: "Past week" },
        { value: "month", label: "Last 30 days", description: "Past month" },
      ],
    } satisfies FilterDef,
    {
      id: "status",
      label: "Status",
      searchable: false,
      value: statusFilter,
      onChange: setStatusFilter,
      options: statusFilterOptions,
    } satisfies FilterDef,
    ...(hasMultipleForms
      ? [
          {
            id: "form",
            label: "Form",
            value: formFilter,
            onChange: setFormFilter,
            options: [
              { value: "all", label: "All Forms", description: "Show leads from all forms" },
              ...formEntries.map(([id, name]) => ({
                value: id,
                label: name,
                description: `Form: ${name}`,
              })),
            ],
          } satisfies FilterDef,
        ]
      : []),
  ];

  return (
    <div className="flex flex-col flex-1 min-h-0 gap-1">
      {/* Enhanced Toolbar */}
      <div className="shrink-0">
        {/* Top Row: Search + Actions */}
        <div className="flex flex-wrap items-center gap-3 p-3">
          {/* Lead count — loaded, not the board's true total (which is per-column) */}
          <div className="text-sm font-medium text-muted-foreground shrink-0">
            {totalLoaded.toLocaleString()} Loaded
          </div>

          {/* Search */}
          <div className="relative w-60">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3 w-3 text-gray-400" />
            <input
              type="text"
              placeholder="Search leads..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className={`w-full ${TOOLBAR_SEARCH_INPUT}`}
            />
          </div>

          {onManageStages && (
            <button
              type="button"
              onClick={onManageStages}
              className={TOOLBAR_BTN}
            >
              <Settings2 className="h-3 w-3 shrink-0" />
              <span>{manageStagesLabel}</span>
            </button>
          )}

          {listViewHref && (
            <a
              href={listViewHref}
              className={TOOLBAR_BTN}
            >
              <LayoutList className="h-3 w-3 shrink-0" />
              <span>List view</span>
            </a>
          )}

          <div className="flex-1" />

          <FilterMenu filters={filterDefs} activeCount={activeFiltersCount} onClearAll={clearFilters} />

          {/* Sort */}
          <Popover>
            <PopoverTrigger asChild>
              <button
                type="button"
                className={TOOLBAR_BTN}
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
              className={TOOLBAR_BTN}
              title={exportIsPartial ? `Only the ${totalLoaded.toLocaleString()} currently-loaded leads will be exported, out of ${totalTrue.toLocaleString()} total` : undefined}
            >
              <Download className="h-3 w-3 shrink-0" />
              {exportIsPartial
                ? `Export (${totalLoaded.toLocaleString()} of ${totalTrue.toLocaleString()})`
                : "Export"}
            </button>
          )}

          {/* Add Lead Button */}
          {canCreateLead && (
            <button
              type="button"
              onClick={() => setAddLeadOpen(true)}
              className={TOOLBAR_PRIMARY_BTN}
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
          <div className="flex gap-4 overflow-x-auto pb-4 pl-3 h-full scrollbar-thin scrollbar-thumb-muted-foreground/20 hover:scrollbar-thumb-muted-foreground/40">
            {stages.map((stage) => {
              const col = columns[stage.id] ?? { cards: [], loaded: 0, total: 0, page: 1, isLoadingMore: false };
              return (
                <PipelineColumn
                  key={stage.id}
                  stage={stage}
                  leads={col.cards}
                  total={col.total}
                  isLoadingMore={col.isLoadingMore}
                  onLoadMore={() => loadMore(stage.id, columnDefs.find((d) => d.key === stage.id)?.params ?? null)}
                  canDragLead={canDragLead}
                  pipelineId={pipelineId}
                  onMovedToPipeline={handleLeadMovedToPipeline}
                  assigneeNames={memberNames}
                />
              );
            })}
          </div>

          <DragOverlay>
            {activeLead ? (
              <LeadCard
                lead={activeLead}
                disabled
                assigneeName={activeLead.assigned_to ? memberNames[activeLead.assigned_to] : undefined}
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
