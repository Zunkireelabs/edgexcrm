"use client";

import { useState, useMemo, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { FilterDropdown } from "@/components/ui/filter-dropdown";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Badge } from "@/components/ui/badge";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Download,
  Search,
  Trash2,
  Users2,
  Globe,
  Calendar,
  ArrowUpDown,
  X,
  ChevronLeft,
  ChevronRight,
  Plus,
  UserPlus,
  Tag,
  GitMerge,
  Briefcase,
  Columns3,
  MoreHorizontal,
  Pencil,
  Building2,
  ArrowRightLeft,
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { PROSPECT_INDUSTRIES } from "@/industries/it-agency/leads/prospect-industries";
import { toast } from "sonner";
import { AddLeadSheet } from "@/components/dashboard/add-lead-sheet";
import { LeadPreviewPanel } from "@/components/dashboard/lead-preview-panel";
import { MergeDialog } from "@/components/dashboard/lead/merge-dialog";
import type { Lead, LeadList, PipelineStage, UserRole, TenantEntity, Branch } from "@/types/database";
import { useBadgeCounts } from "@/hooks/use-badge-counts";
import {
  getLeadColumns,
  getDefaultVisibleKeys,
  type LeadColumn,
  type LeadColumnCtx,
} from "@/components/dashboard/leads/columns-registry";
import { loadColumnPrefs, saveColumnPrefs, clearColumnPrefs } from "@/lib/leads/column-prefs";
import { ColumnManagerDialog } from "@/components/dashboard/leads/column-manager-dialog";

type SortField = "activity" | "created" | "updated" | "name" | "email";
type SortDirection = "asc" | "desc";

interface TeamMember {
  user_id: string;
  email: string;
  role: string;
}

interface LeadsTableProps {
  leads: Lead[];
  memberMap?: Record<string, string>;
  stages?: PipelineStage[];
  formMap?: Record<string, string>;
  role?: UserRole;
  tenantId?: string;
  teamMembers?: TeamMember[];
  entities?: TenantEntity[];
  entityLabel?: string;
  currentUserId?: string;
  industryId?: string | null;
  branches?: Branch[];
  maxBranches?: number;
  selectedBranchId?: string | null;
  userBranchId?: string | null;
  leadLists?: LeadList[];
}

function getInitials(firstName?: string | null, lastName?: string | null): string {
  const first = firstName?.charAt(0)?.toUpperCase() || "";
  const last = lastName?.charAt(0)?.toUpperCase() || "";
  return first + last || "?";
}

export function LeadsTable({
  leads,
  memberMap = {},
  stages = [],
  formMap = {},
  role = "viewer",
  tenantId = "",
  teamMembers = [],
  entities = [],
  entityLabel,
  currentUserId = "",
  industryId,
  branches = [],
  maxBranches = 1,
  selectedBranchId = null,
  userBranchId = null,
  leadLists = [],
}: LeadsTableProps) {
  const router = useRouter();
  const showTags = industryId === "education_consultancy";
  const [localLeads, setLocalLeads] = useState(leads);
  // Re-sync when the server sends a new lead set — list switch (?list=…),
  // branch switch (router.refresh), etc. Without this the table shows stale
  // rows until a manual page reload.
  useEffect(() => {
    setLocalLeads(leads);
  }, [leads]);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [formFilter, setFormFilter] = useState<string>("all");
  const [counselorFilter, setCounselorFilter] = useState<string>("all");
  const [sourceFilter, setSourceFilter] = useState<string>("all");
  const [tagFilter, setTagFilter] = useState<string>("all");
  const [createdFilter, setCreatedFilter] = useState<string>("all");
  const [prospectIndustryFilter, setProspectIndustryFilter] = useState<string>("all");
  const [sortField, setSortField] = useState<SortField>("activity");
  const [sortDirection, setSortDirection] = useState<SortDirection>("desc");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [assignDialogOpen, setAssignDialogOpen] = useState(false);
  const [mergeDialogOpen, setMergeDialogOpen] = useState(false);
  const [isAssigning, setIsAssigning] = useState(false);
  const [assignTo, setAssignTo] = useState<string>("");
  const [addLeadOpen, setAddLeadOpen] = useState(false);
  const [previewLeadId, setPreviewLeadId] = useState<string | null>(null);
  const [branchAssignDialogOpen, setBranchAssignDialogOpen] = useState(false);
  const [assignToBranch, setAssignToBranch] = useState<string>("");
  const [isAssigningBranch, setIsAssigningBranch] = useState(false);
  const [moveListDialogOpen, setMoveListDialogOpen] = useState(false);
  const [moveListId, setMoveListId] = useState<string>("");
  const [moveArchiveReason, setMoveArchiveReason] = useState<string>("");
  const [isMoveList, setIsMoveList] = useState(false);

  // Pagination state
  const [currentPage, setCurrentPage] = useState(1);
  const [itemsPerPage, setItemsPerPage] = useState(25);

  const { counts } = useBadgeCounts();
  const unreadLeadIds = useMemo(() => new Set(counts.unread_lead_ids), [counts.unread_lead_ids]);

  const isAdmin = role === "admin" || role === "owner";
  const canCreateLead = role !== "viewer";
  const showItAgencyFields = industryId === "it_agency";
  const showBranches = maxBranches > 1;

  const formEntries = useMemo(() => Object.entries(formMap), [formMap]);
  const hasMultipleForms = formEntries.length > 1;

  // Get unique sources from leads
  const sources = useMemo(() => {
    const s = new Set<string>();
    leads.forEach(l => {
      if (l.intake_source) s.add(l.intake_source);
    });
    return Array.from(s).sort();
  }, [leads]);

  // Get unique counselors (assigned_to users)
  const counselors = useMemo(() => {
    const c = new Map<string, string>();
    Object.entries(memberMap).forEach(([userId, email]) => {
      c.set(userId, email);
    });
    return Array.from(c.entries());
  }, [memberMap]);

  const filtered = useMemo(() => {
    const now = Date.now();

    let result = localLeads.filter((lead) => {
      const matchesStatus =
        statusFilter === "all" || lead.status === statusFilter;
      const matchesForm =
        formFilter === "all" || lead.form_config_id === formFilter;
      const matchesCounselor =
        counselorFilter === "all" ||
        (counselorFilter === "unassigned" ? !lead.assigned_to : lead.assigned_to === counselorFilter);
      const matchesSource =
        sourceFilter === "all" || lead.intake_source === sourceFilter;

      const matchesTag =
        tagFilter === "all" || (lead.tags && lead.tags.includes(tagFilter));

      const matchesProspectIndustry =
        prospectIndustryFilter === "all" ||
        (prospectIndustryFilter === "__none__"
          ? !lead.prospect_industry
          : lead.prospect_industry === prospectIndustryFilter);

      // Created date filter
      let matchesCreated = true;
      if (createdFilter !== "all") {
        const createdAt = new Date(lead.created_at).getTime();
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

      const searchLower = search.toLowerCase();
      const assignedEmail = lead.assigned_to ? memberMap[lead.assigned_to] || "" : "";
      const matchesSearch =
        !search ||
        lead.first_name?.toLowerCase().includes(searchLower) ||
        lead.last_name?.toLowerCase().includes(searchLower) ||
        lead.email?.toLowerCase().includes(searchLower) ||
        lead.phone?.toLowerCase().includes(searchLower) ||
        lead.city?.toLowerCase().includes(searchLower) ||
        assignedEmail.toLowerCase().includes(searchLower);
      return matchesStatus && matchesSearch && matchesForm && matchesCounselor && matchesSource && matchesTag && matchesCreated && matchesProspectIndustry;
    });

    // Apply sorting
    result = [...result].sort((a, b) => {
      let comparison = 0;
      switch (sortField) {
        case "activity":
          comparison = new Date(a.last_activity_at).getTime() - new Date(b.last_activity_at).getTime();
          break;
        case "updated":
          comparison = new Date(a.updated_at).getTime() - new Date(b.updated_at).getTime();
          break;
        case "created":
          comparison = new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
          break;
        case "name": {
          const nameA = `${a.first_name || ""} ${a.last_name || ""}`.trim().toLowerCase();
          const nameB = `${b.first_name || ""} ${b.last_name || ""}`.trim().toLowerCase();
          comparison = nameA.localeCompare(nameB);
          break;
        }
        case "email": {
          const emailA = (a.email || "").toLowerCase();
          const emailB = (b.email || "").toLowerCase();
          comparison = emailA.localeCompare(emailB);
          break;
        }
        default:
          comparison = 0;
      }
      return sortDirection === "asc" ? comparison : -comparison;
    });

    return result;
  }, [localLeads, search, statusFilter, formFilter, counselorFilter, sourceFilter, tagFilter, createdFilter, prospectIndustryFilter, sortField, sortDirection, memberMap]);

  const clearFilters = () => {
    setSearch("");
    setStatusFilter("all");
    setFormFilter("all");
    setCounselorFilter("all");
    setSourceFilter("all");
    setTagFilter("all");
    setCreatedFilter("all");
    setProspectIndustryFilter("all");
    setCurrentPage(1);
  };

  const activeFiltersCount = [
    search !== "",
    statusFilter !== "all",
    formFilter !== "all",
    counselorFilter !== "all",
    sourceFilter !== "all",
    tagFilter !== "all",
    createdFilter !== "all",
    prospectIndustryFilter !== "all",
  ].filter(Boolean).length;

  const hasActiveFilters = activeFiltersCount > 0;

  // Pagination calculations
  const totalPages = Math.ceil(filtered.length / itemsPerPage);
  const startIndex = (currentPage - 1) * itemsPerPage;
  const endIndex = Math.min(startIndex + itemsPerPage, filtered.length);
  const paginatedLeads = useMemo(() => {
    return filtered.slice(startIndex, endIndex);
  }, [filtered, startIndex, endIndex]);

  // Reset to page 1 when filters change
  useEffect(() => {
    if (currentPage > totalPages && totalPages > 0) {
      setCurrentPage(1);
    }
  }, [currentPage, totalPages]);

  const filteredIds = useMemo(() => new Set(paginatedLeads.map((l) => l.id)), [paginatedLeads]);

  const selectedCount = selectedIds.size;
  const allSelected = paginatedLeads.length > 0 && paginatedLeads.every((l) => selectedIds.has(l.id));
  const someSelected = paginatedLeads.some((l) => selectedIds.has(l.id)) && !allSelected;

  function toggleSelectAll() {
    if (allSelected) {
      setSelectedIds((prev) => {
        const next = new Set(prev);
        paginatedLeads.forEach((l) => next.delete(l.id));
        return next;
      });
    } else {
      setSelectedIds((prev) => {
        const next = new Set(prev);
        paginatedLeads.forEach((l) => next.add(l.id));
        return next;
      });
    }
  }

  function toggleSelect(id: string) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  }

  async function handleBulkDelete() {
    const idsToDelete = Array.from(selectedIds).filter((id) => filteredIds.has(id));

    if (idsToDelete.length === 0) {
      toast.error("No leads selected");
      return;
    }

    setIsDeleting(true);
    try {
      const response = await fetch("/api/v1/leads/bulk", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids: idsToDelete }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error?.message || "Failed to delete leads");
      }

      toast.success(`Deleted ${data.data.deleted} lead${data.data.deleted !== 1 ? "s" : ""}`);
      setSelectedIds(new Set());
      setDeleteDialogOpen(false);
      router.refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to delete leads");
    } finally {
      setIsDeleting(false);
    }
  }

  async function handleBulkAssign() {
    const idsToAssign = Array.from(selectedIds).filter((id) => filteredIds.has(id));

    if (idsToAssign.length === 0) {
      toast.error("No leads selected");
      return;
    }

    setIsAssigning(true);
    try {
      const response = await fetch("/api/v1/leads/bulk", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ids: idsToAssign,
          assigned_to: assignTo === "unassign" ? null : assignTo,
        }),
      });

      const data = await response.json();

      if (!response.ok) {
        throw new Error(data.error?.message || "Failed to assign leads");
      }

      const action = assignTo === "unassign" ? "Unassigned" : "Assigned";
      toast.success(`${action} ${data.data.updated} lead${data.data.updated !== 1 ? "s" : ""}`);
      setSelectedIds(new Set());
      setAssignDialogOpen(false);
      setAssignTo("");
      router.refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to assign leads");
    } finally {
      setIsAssigning(false);
    }
  }

  async function handleBulkAssignBranch() {
    const idsToAssign = Array.from(selectedIds).filter((id) => filteredIds.has(id));
    if (idsToAssign.length === 0) {
      toast.error("No leads selected");
      return;
    }
    setIsAssigningBranch(true);
    try {
      const response = await fetch("/api/v1/leads/bulk/share", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ids: idsToAssign,
          branch_ids: [assignToBranch],
        }),
      });
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error?.message || "Failed to share leads");
      }
      const count = data.data.shared as number;
      const branchName = branches.find((b) => b.id === assignToBranch)?.name ?? "branch";
      toast.success(`Shared ${count} lead${count !== 1 ? "s" : ""} to ${branchName}`);
      setSelectedIds(new Set());
      setBranchAssignDialogOpen(false);
      setAssignToBranch("");
      router.refresh();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Failed to share leads");
    } finally {
      setIsAssigningBranch(false);
    }
  }

  const moveTargetList = leadLists.find((l) => l.id === moveListId) ?? null;
  const moveTargetIsArchive = moveTargetList?.is_archive ?? false;

  const CHUNK_SIZE = 100;

  async function handleBulkMove() {
    const idsToMove = Array.from(selectedIds).filter((id) => filteredIds.has(id));
    if (idsToMove.length === 0) {
      toast.error("No leads selected");
      return;
    }
    if (!moveListId) {
      toast.error("Please select a target list");
      return;
    }
    if (moveTargetIsArchive && !moveArchiveReason.trim()) {
      toast.error("Archive reason is required");
      return;
    }

    setIsMoveList(true);
    const chunks: string[][] = [];
    for (let i = 0; i < idsToMove.length; i += CHUNK_SIZE) {
      chunks.push(idsToMove.slice(i, i + CHUNK_SIZE));
    }

    let totalMoved = 0;
    try {
      for (let i = 0; i < chunks.length; i++) {
        if (chunks.length > 1) {
          toast.loading(`Moving… chunk ${i + 1}/${chunks.length}`, { id: "bulk-move" });
        }
        const response = await fetch("/api/v1/leads/bulk", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            ids: chunks[i],
            list_id: moveListId,
            ...(moveArchiveReason.trim() && { archive_reason: moveArchiveReason.trim() }),
          }),
        });
        const data = await response.json();
        if (!response.ok) {
          throw new Error(data.error?.message || "Failed to move leads");
        }
        totalMoved += data.data.updated as number;
      }
      toast.dismiss("bulk-move");
      toast.success(`Moved ${totalMoved} lead${totalMoved !== 1 ? "s" : ""} to ${moveTargetList?.name ?? "list"}`);
      setSelectedIds(new Set());
      setMoveListDialogOpen(false);
      setMoveListId("");
      setMoveArchiveReason("");
      router.refresh();
    } catch (error) {
      toast.dismiss("bulk-move");
      toast.error(error instanceof Error ? error.message : "Failed to move leads");
    } finally {
      setIsMoveList(false);
    }
  }

  function exportCSV() {
    const exportCols = visibleColumns.filter((c) => c.key !== "actions");
    const headers = exportCols.map((c) => c.label);
    const rows = filtered.map((lead) =>
      exportCols.map((col): string => {
        switch (col.key) {
          case "name":
            return `${lead.first_name || ""} ${lead.last_name || ""}`.trim();
          case "email":
            return lead.email || "";
          case "phone":
            return lead.phone || "";
          case "location":
            return [lead.city, lead.country].filter(Boolean).join(", ");
          case "assigned": {
            const email = lead.assigned_to ? memberMap[lead.assigned_to] : null;
            return email ? email.split("@")[0] : "";
          }
          case "status": {
            const stage = stages.find((s) => s.id === lead.stage_id);
            return stage?.name || lead.status;
          }
          case "source": {
            const formName = lead.form_config_id ? formMap[lead.form_config_id] : null;
            const src = formName || lead.intake_source;
            return src ? src.replace(/_/g, " ") : "";
          }
          case "medium":
            return lead.intake_medium || "";
          case "campaign":
            return lead.intake_campaign || "";
          case "last_activity":
            return new Date(lead.last_activity_at).toLocaleDateString();
          case "created":
            return new Date(lead.created_at).toLocaleDateString();
          case "preferred_contact":
            return lead.preferred_contact_method || "";
          case "display_id":
            return lead.display_id || "";
          case "ai_score":
            return lead.ai_score != null ? String(lead.ai_score) : "";
          case "ai_priority":
            return lead.ai_priority || "";
          case "tags":
            return (lead.tags || []).join(", ");
          case "lead_type":
            return lead.lead_type || "lead";
          case "company":
            return lead.company_name || "";
          case "designation":
            return lead.designation || "";
          case "prospect_industry":
            return lead.prospect_industry || "";
          case "salutation":
            return lead.salutation || "";
          case "company_email":
            return lead.company_email || "";
          case "owner": {
            const email = lead.owner_id ? memberMap[lead.owner_id] : null;
            return email ? email.split("@")[0] : "";
          }
          default:
            if (col.key.startsWith("cf:")) {
              return String(lead.custom_fields?.[col.key.slice(3)] ?? "");
            }
            return "";
        }
      }),
    );
    const csv = [headers, ...rows]
      .map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(","))
      .join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `leads-${new Date().toISOString().split("T")[0]}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  const previewLead = localLeads.find((l) => l.id === previewLeadId) || null;

  // ── Column registry (Phase 2) ─────────────────────────────────────────────
  // Discover custom-field keys across loaded leads.
  const customFieldKeys = useMemo(() => {
    const keySet = new Set<string>();
    localLeads.forEach((lead) => {
      if (lead.custom_fields) {
        Object.keys(lead.custom_fields).forEach((k) => keySet.add(k));
      }
    });
    return Array.from(keySet).sort();
  }, [localLeads]);

  // Full column catalog for this industry + discovered custom fields.
  const allColumns = useMemo(
    () => getLeadColumns(industryId, customFieldKeys, maxBranches),
    [industryId, customFieldKeys, maxBranches],
  );

  // Default middle visible keys (anchors name + actions always implicit).
  const defaultMiddleKeys = useMemo(() => {
    const defaults = getDefaultVisibleKeys(industryId, maxBranches);
    return defaults.filter((k) => k !== "name" && k !== "actions");
  }, [industryId, maxBranches]);

  // Managed visible middle keys — initialized to defaults, then loaded from localStorage.
  const [visibleKeys, setVisibleKeys] = useState<string[]>(defaultMiddleKeys);
  const [columnDialogOpen, setColumnDialogOpen] = useState(false);

  // Load saved column prefs after mount to avoid SSR hydration mismatch.
  // Intentionally narrow deps — reload only when tenant/user identity changes.
  useEffect(() => {
    if (!tenantId || !currentUserId) return;
    const cfKeys = Array.from(
      new Set(leads.flatMap((l) => (l.custom_fields ? Object.keys(l.custom_fields) : []))),
    ).sort().map((k) => `cf:${k}`);
    const staticKeys = getLeadColumns(industryId, [])
      .filter((c) => !c.required)
      .map((c) => c.key);
    const validKeys = [...staticKeys, ...cfKeys];
    const defKeys = getDefaultVisibleKeys(industryId).filter(
      (k) => k !== "name" && k !== "actions",
    );
    setVisibleKeys(loadColumnPrefs(tenantId, currentUserId, validKeys, defKeys));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tenantId, currentUserId]);

  // Resolve ordered column objects: name anchor → middle → actions anchor.
  const visibleColumns = useMemo<LeadColumn[]>(() => {
    const colMap = new Map(allColumns.map((c) => [c.key, c]));
    const nameCol = colMap.get("name");
    const actionsCol = colMap.get("actions");
    const middleCols = visibleKeys
      .map((k) => colMap.get(k))
      .filter((c): c is LeadColumn => c !== undefined);
    return [
      ...(nameCol ? [nameCol] : []),
      ...middleCols,
      ...(actionsCol ? [actionsCol] : []),
    ];
  }, [allColumns, visibleKeys]);

  // Handlers for the column manager dialog.
  function handleColumnApply(keys: string[]) {
    setVisibleKeys(keys);
    saveColumnPrefs(tenantId, currentUserId, keys);
  }

  function handleColumnReset() {
    clearColumnPrefs(tenantId, currentUserId);
    setVisibleKeys(defaultMiddleKeys);
  }

  // Context object passed to registry render functions.
  // Callbacks use stable setters so they don't need to appear in deps.
  const entityMap = useMemo(
    () => Object.fromEntries(entities.map((e) => [e.id, e.name])),
    [entities],
  );

  const branchMap = useMemo(
    () => Object.fromEntries(branches.map((b) => [b.id, b.name])),
    [branches],
  );

  const columnCtx: LeadColumnCtx = useMemo(
    () => ({
      memberMap,
      formMap,
      entityMap,
      branchMap,
      stages,
      industryId,
      selectedIds,
      unreadLeadIds,
      onToggleSelect: (id: string) => {
        setSelectedIds((prev) => {
          const next = new Set(prev);
          if (next.has(id)) {
            next.delete(id);
          } else {
            next.add(id);
          }
          return next;
        });
      },
      onPreviewToggle: (id: string) =>
        setPreviewLeadId((prev) => (prev === id ? null : id)),
      onTagUpdate: (leadId: string, tags: string[]) =>
        setLocalLeads((prev) =>
          prev.map((l) => (l.id === leadId ? { ...l, tags } : l)),
        ),
      onTypeUpdate: (leadId: string, type: string) =>
        setLocalLeads((prev) =>
          prev.map((l) => (l.id === leadId ? { ...l, lead_type: type } : l)),
        ),
      leadLists: leadLists.length > 0 ? leadLists : undefined,
      onListMove: leadLists.length > 0
        ? async (leadId: string, listId: string, archiveReason?: string) => {
            // Optimistic update
            const targetList = leadLists.find((l) => l.id === listId);
            setLocalLeads((prev) =>
              prev.map((l) =>
                l.id === leadId
                  ? {
                      ...l,
                      list_id: listId,
                      lead_type: targetList?.slug === "prospects" ? "prospect" : "lead",
                      ...(archiveReason ? { archive_reason: archiveReason } : {}),
                    }
                  : l
              )
            );
            try {
              const res = await fetch(`/api/v1/leads/${leadId}`, {
                method: "PATCH",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ list_id: listId, ...(archiveReason ? { archive_reason: archiveReason } : {}) }),
              });
              if (!res.ok) throw new Error("Failed to move lead");
            } catch {
              // Revert on failure
              setLocalLeads((prev) =>
                prev.map((l) =>
                  l.id === leadId
                    ? { ...leads.find((orig) => orig.id === leadId) ?? l }
                    : l
                )
              );
            }
          }
        : undefined,
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [memberMap, formMap, entityMap, branchMap, stages, industryId, selectedIds, unreadLeadIds, leadLists],
  );

  // Total column count: 2 anchors (select + avatar) + visible data columns + 1 actions column
  const totalColSpan = 3 + visibleColumns.length;

  return (
    <div className="flex flex-1 min-h-0 gap-0">
      {/* Main Table Section - shrinks when preview is open */}
      <div className={`flex flex-col flex-1 min-h-0 min-w-0 gap-2 overflow-hidden transition-[padding] duration-500 ease-out ${previewLead ? 'pr-4' : 'pr-6'}`}>

      {/* Enhanced Toolbar - matching pipeline style */}
      <div className="shrink-0 bg-card rounded-lg border">
        {/* Top Row: Search + Actions */}
        <div className="flex flex-wrap items-center gap-3 p-3">
          {/* Lead count */}
          <div className="text-sm font-medium text-muted-foreground shrink-0">
            {filtered.length} Leads
          </div>

          {/* Search */}
          <div className="relative w-60">
            <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3 w-3 text-gray-400" />
            <input
              type="text"
              placeholder="Search leads..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full h-7 pl-7 pr-3 rounded-md border border-gray-300 bg-white text-xs text-gray-600 placeholder:text-gray-400 outline-none focus:ring-1 focus:ring-ring"
            />
          </div>

          {/* Edit columns — placed right after the search bar */}
          <button
            type="button"
            onClick={() => setColumnDialogOpen(true)}
            className="inline-flex items-center gap-1.5 h-7 px-2.5 text-xs font-medium rounded-md border transition-colors border-gray-300 bg-white text-gray-600 hover:bg-[#0000170b]"
          >
            <Columns3 className="h-3 w-3 shrink-0" />
            <span>Edit columns</span>
          </button>

          <div className="flex-1" />

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
                      <SelectItem value="activity">Last activity</SelectItem>
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

          {/* Export */}
          <button
            type="button"
            onClick={exportCSV}
            className="inline-flex items-center gap-1.5 h-7 px-2.5 text-xs font-medium rounded-md border transition-colors border-gray-300 bg-white text-gray-600 hover:bg-[#0000170b]"
          >
            <Download className="h-3 w-3 shrink-0" />
            Export
          </button>

          {/* Add Lead Button */}
          {canCreateLead && tenantId && (
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

        {/* Divider */}
        <div className="h-px bg-border" />

        {/* Filter Row - Compact */}
        <div className="flex flex-wrap items-center gap-1.5 px-3 py-2">
          {/* Counselor Filter (Admin only) */}
          {isAdmin && counselors.length > 0 && (
            <FilterDropdown
              label="All Counselors"
              value={counselorFilter}
              onChange={(val) => {
                setCounselorFilter(val);
                setCurrentPage(1);
              }}
              icon={<Users2 className="h-3 w-3" />}
              options={[
                { value: "all", label: "All Counselors", description: "Show leads from everyone" },
                { value: "unassigned", label: "Unassigned", description: "Leads not assigned yet" },
                ...counselors.map(([userId, email]) => ({
                  value: userId,
                  label: email.split("@")[0],
                  description: email,
                })),
              ]}
            />
          )}

          {/* Source Filter */}
          {sources.length > 0 && (
            <FilterDropdown
              label="All Sources"
              value={sourceFilter}
              onChange={(val) => {
                setSourceFilter(val);
                setCurrentPage(1);
              }}
              icon={<Globe className="h-3 w-3" />}
              options={[
                { value: "all", label: "All Sources", description: "Show leads from all sources" },
                ...sources.map((s) => ({
                  value: s,
                  label: s,
                  description: `Leads from ${s}`,
                })),
              ]}
            />
          )}

          {/* Tag Filter — education_consultancy only */}
          {showTags && (
            <FilterDropdown
              label="All Tags"
              value={tagFilter}
              onChange={(val) => {
                setTagFilter(val);
                setCurrentPage(1);
              }}
              icon={<Tag className="h-3 w-3" />}
              options={[
                { value: "all", label: "All Tags", description: "Show all leads" },
                { value: "student", label: "Student", description: "Student leads only" },
                { value: "parent", label: "Parent", description: "Parent leads only" },
              ]}
            />
          )}

          {/* Prospect Industry Filter — it_agency only */}
          {showItAgencyFields && (
            <FilterDropdown
              label="All Industries"
              value={prospectIndustryFilter}
              onChange={(val) => {
                setProspectIndustryFilter(val);
                setCurrentPage(1);
              }}
              icon={<Briefcase className="h-3 w-3" />}
              options={[
                { value: "all", label: "All Industries", description: "Show all leads" },
                ...PROSPECT_INDUSTRIES.map((ind) => ({
                  value: ind.value,
                  label: ind.label,
                  description: `${ind.label} leads`,
                })),
                { value: "__none__", label: "Unspecified", description: "Leads with no industry set" },
              ]}
            />
          )}

          {/* Created Date Filter */}
          <FilterDropdown
            label="Any time"
            value={createdFilter}
            onChange={(val) => {
              setCreatedFilter(val);
              setCurrentPage(1);
            }}
            icon={<Calendar className="h-3 w-3" />}
            searchable={false}
            options={[
              { value: "all", label: "Any time", description: "All time periods" },
              { value: "today", label: "Today", description: "Last 24 hours" },
              { value: "week", label: "Last 7 days", description: "Past week" },
              { value: "month", label: "Last 30 days", description: "Past month" },
            ]}
          />

          {/* Status Filter */}
          <FilterDropdown
            label="All Status"
            value={statusFilter}
            onChange={(val) => {
              setStatusFilter(val);
              setCurrentPage(1);
            }}
            searchable={false}
            options={[
              { value: "all", label: "All Status", description: "Show all leads" },
              { value: "new", label: "New", description: "Fresh submissions" },
              { value: "partial", label: "Partial", description: "Incomplete forms" },
              { value: "contacted", label: "Contacted", description: "In communication" },
              { value: "enrolled", label: "Enrolled", description: "Successfully converted" },
              { value: "rejected", label: "Rejected", description: "Not moving forward" },
            ]}
          />

          {/* Form Filter (if multiple forms) */}
          {hasMultipleForms && (
            <FilterDropdown
              label="All Forms"
              value={formFilter}
              onChange={(val) => {
                setFormFilter(val);
                setCurrentPage(1);
              }}
              options={[
                { value: "all", label: "All Forms", description: "Show leads from all forms" },
                ...formEntries.map(([id, name]) => ({
                  value: id,
                  label: name,
                  description: `Form: ${name}`,
                })),
              ]}
            />
          )}

          <div className="flex-1" />

          {/* Active Filters Indicator + Clear */}
          {hasActiveFilters && (
            <div className="flex items-center gap-1.5">
              <Badge variant="secondary" className="text-[11px] font-normal h-6 px-2">
                {activeFiltersCount} filter{activeFiltersCount !== 1 ? "s" : ""}
              </Badge>
              <Button
                variant="ghost"
                size="sm"
                onClick={clearFilters}
                className="h-6 px-2 text-[11px] text-muted-foreground hover:text-foreground"
              >
                <X className="h-3 w-3 mr-1" />
                Clear
              </Button>
            </div>
          )}
        </div>
      </div>

      {/* Bulk Action Bar - animated container between filters and table */}
      <div
        className={`shrink-0 overflow-hidden transition-all duration-300 ease-out ${
          selectedCount > 0 ? 'max-h-[52px] opacity-100' : 'max-h-0 opacity-0'
        }`}
      >
        <div className="flex items-center justify-between px-4 py-2 bg-white rounded-lg border border-gray-200">
          <span className="text-sm font-medium text-gray-700">
            {selectedCount} lead{selectedCount !== 1 ? "s" : ""} selected
          </span>
          <div className="flex items-center gap-1">
            {isAdmin && teamMembers.length > 0 && (
              <button
                onClick={() => setAssignDialogOpen(true)}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm text-gray-600 hover:text-gray-900 hover:bg-gray-100 rounded transition-colors"
              >
                <UserPlus className="h-4 w-4" />
                Assign
              </button>
            )}
            {isAdmin && showBranches && branches.length > 0 && (
              <button
                onClick={() => setBranchAssignDialogOpen(true)}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm text-gray-600 hover:text-gray-900 hover:bg-gray-100 rounded transition-colors"
              >
                <Building2 className="h-4 w-4" />
                Branch
              </button>
            )}
            {isAdmin && leadLists.length > 0 && (
              <button
                onClick={() => setMoveListDialogOpen(true)}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm text-gray-600 hover:text-gray-900 hover:bg-gray-100 rounded transition-colors"
              >
                <ArrowRightLeft className="h-4 w-4" />
                Move to list
              </button>
            )}
            {isAdmin && selectedCount === 2 && (
              <button
                onClick={() => setMergeDialogOpen(true)}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm text-gray-600 hover:text-indigo-600 hover:bg-indigo-50 rounded transition-colors"
              >
                <GitMerge className="h-4 w-4" />
                Merge
              </button>
            )}
            <button
              onClick={() => setDeleteDialogOpen(true)}
              className="inline-flex items-center gap-1.5 px-3 py-1.5 text-sm text-gray-600 hover:text-red-600 hover:bg-red-50 rounded transition-colors"
            >
              <Trash2 className="h-4 w-4" />
              Delete
            </button>
            <div className="w-px h-4 bg-gray-200 mx-1" />
            <button
              onClick={() => setSelectedIds(new Set())}
              className="p-1.5 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded transition-colors"
              aria-label="Deselect all"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>
      </div>

      {/* Table - Compact style with sticky header and horizontal scroll */}
      <div className="flex-1 min-h-0 bg-white rounded-[0.75rem] border border-gray-200 flex flex-col overflow-hidden">
        <div className="flex-1 min-h-0 overflow-auto">
          <table className="w-full min-w-[900px]">
          <thead className="sticky top-0 z-10">
            <tr className="border-b border-gray-200 bg-gray-50">
              {/* Anchor: select checkbox */}
              <th className="pl-3 pr-1 py-2 text-left w-10">
                <Checkbox
                  checked={someSelected ? "indeterminate" : allSelected}
                  onCheckedChange={toggleSelectAll}
                  aria-label="Select all"
                />
              </th>
              {/* Anchor: ⋯ hover slot */}
              <th className="px-1 py-2 w-7"></th>
              {/* Anchor: avatar */}
              <th className="px-2 py-2 text-left w-8"></th>
              {/* Data columns from registry */}
              {visibleColumns.map((col) => col.renderTh(columnCtx))}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {paginatedLeads.length === 0 ? (
              <tr>
                <td
                  colSpan={totalColSpan}
                  className="text-center py-12 text-gray-500"
                >
                  <p>No leads found</p>
                  <p className="text-sm mt-1">Try adjusting your search or filters</p>
                </td>
              </tr>
            ) : (
              paginatedLeads.map((lead) => {
                const isSelected = selectedIds.has(lead.id);
                const initials = getInitials(lead.first_name, lead.last_name);

                return (
                  <tr
                    key={lead.id}
                    className={`group hover:bg-gray-50 transition-colors ${isSelected ? "bg-blue-50" : ""}`}
                  >
                    {/* Anchor: select checkbox */}
                    <td className="pl-3 pr-1 py-1.5" onClick={(e) => e.stopPropagation()}>
                      <Checkbox
                        checked={isSelected}
                        onCheckedChange={() => toggleSelect(lead.id)}
                        aria-label={`Select ${lead.first_name} ${lead.last_name}`}
                      />
                    </td>
                    {/* Anchor: ⋯ hover slot */}
                    <td className="px-1 py-1.5 w-7" onClick={(e) => e.stopPropagation()}>
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <button
                            type="button"
                            aria-label="Row actions"
                            className="h-6 w-6 rounded flex items-center justify-center text-gray-400 hover:text-gray-700 hover:bg-gray-100 transition-all opacity-0 group-hover:opacity-100 data-[state=open]:opacity-100"
                          >
                            <MoreHorizontal className="h-3.5 w-3.5" />
                          </button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="start">
                          <DropdownMenuItem onClick={() => router.push(`/leads/${lead.id}?edit=1`)}>
                            <Pencil className="h-4 w-4 mr-2" />
                            Edit
                          </DropdownMenuItem>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    </td>
                    {/* Anchor: avatar */}
                    <td className="px-2 py-1.5">
                      <div className="h-6 w-6 rounded-full flex items-center justify-center bg-gray-100 border border-gray-300 text-gray-500 text-xs font-medium">
                        {initials}
                      </div>
                    </td>
                    {/* Data columns from registry */}
                    {visibleColumns.map((col) => col.renderTd(lead, columnCtx))}
                  </tr>
                );
              })
            )}
          </tbody>
          </table>
        </div>
        {/* Pagination Controls - Zunkireelabs style (inside white card) */}
        <div className="shrink-0 flex justify-between items-center px-3 py-2 border-t border-gray-100">
          <span className="text-xs text-gray-500">
            Showing {startIndex + 1}-{endIndex} of {filtered.length}
          </span>
          <div className="flex items-center gap-4">
            {/* Per page dropdown */}
            <div className="flex items-center gap-2">
              <span className="text-xs text-gray-500">per page</span>
              <Select
                value={String(itemsPerPage)}
                onValueChange={(v) => {
                  setItemsPerPage(Number(v));
                  setCurrentPage(1);
                }}
              >
                <SelectTrigger className="h-7 w-16 text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="10">10</SelectItem>
                  <SelectItem value="25">25</SelectItem>
                  <SelectItem value="50">50</SelectItem>
                  <SelectItem value="100">100</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {/* Page navigation */}
            <div className="flex items-center gap-1">
              <button
                disabled={currentPage <= 1}
                onClick={() => setCurrentPage((p) => p - 1)}
                className="p-1 rounded hover:bg-gray-100 text-gray-500 hover:text-gray-700 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>
              <span className="text-xs text-gray-600 px-2">
                Page {currentPage} of {totalPages || 1}
              </span>
              <button
                disabled={currentPage >= totalPages}
                onClick={() => setCurrentPage((p) => p + 1)}
                className="p-1 rounded hover:bg-gray-100 text-gray-500 hover:text-gray-700 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
              >
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        </div>
      </div>
      </div>
      {/* End of Main Table Section */}

      {/* Lead Preview Panel - side by side with animation */}
      <div
        className={`h-full transition-all duration-500 ease-out overflow-hidden ${
          previewLead ? 'w-[404px] opacity-100' : 'w-0 opacity-0'
        }`}
      >
        <div
          className={`h-full transition-transform duration-500 ease-out ${
            previewLead ? 'translate-x-0' : 'translate-x-8'
          }`}
        >
          {previewLead && (
            <LeadPreviewPanel
              lead={previewLead}
              onClose={() => setPreviewLeadId(null)}
              stages={stages}
              memberMap={memberMap}
            />
          )}
        </div>
      </div>

      {/* Delete Confirmation Dialog */}
      <Dialog open={deleteDialogOpen} onOpenChange={setDeleteDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete {selectedCount} lead{selectedCount !== 1 ? "s" : ""}?</DialogTitle>
            <DialogDescription>
              This action cannot be undone. The selected leads will be permanently
              removed from your workspace.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setDeleteDialogOpen(false)}
              disabled={isDeleting}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={handleBulkDelete}
              disabled={isDeleting}
            >
              {isDeleting ? "Deleting..." : "Delete"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Bulk Assign Dialog */}
      <Dialog open={assignDialogOpen} onOpenChange={(open) => {
        setAssignDialogOpen(open);
        if (!open) setAssignTo("");
      }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Assign {selectedCount} lead{selectedCount !== 1 ? "s" : ""}</DialogTitle>
            <DialogDescription>
              Select a team member to assign the selected leads to, or unassign them.
            </DialogDescription>
          </DialogHeader>
          <div className="py-4">
            <Select value={assignTo} onValueChange={setAssignTo}>
              <SelectTrigger className="w-full">
                <SelectValue placeholder="Select team member..." />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="unassign">
                  <span className="text-muted-foreground">Unassign (remove assignment)</span>
                </SelectItem>
                {teamMembers
                  .filter((m) => m.role !== "viewer")
                  .map((member) => (
                    <SelectItem key={member.user_id} value={member.user_id}>
                      <div className="flex items-center gap-2">
                        <span>{member.email.split("@")[0]}</span>
                        <span className="text-xs text-muted-foreground">({member.role})</span>
                      </div>
                    </SelectItem>
                  ))}
              </SelectContent>
            </Select>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setAssignDialogOpen(false);
                setAssignTo("");
              }}
              disabled={isAssigning}
            >
              Cancel
            </Button>
            <Button
              onClick={handleBulkAssign}
              disabled={isAssigning || !assignTo}
            >
              {isAssigning ? "Assigning..." : assignTo === "unassign" ? "Unassign" : "Assign"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Bulk Branch Share Dialog */}
      <Dialog open={branchAssignDialogOpen} onOpenChange={(open) => {
        setBranchAssignDialogOpen(open);
        if (!open) setAssignToBranch("");
      }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Share {selectedCount} lead{selectedCount !== 1 ? "s" : ""} to branch</DialogTitle>
            <DialogDescription>
              Add the selected leads to a branch (they stay in their current branches).
            </DialogDescription>
          </DialogHeader>
          <div className="py-4">
            <Select value={assignToBranch} onValueChange={setAssignToBranch}>
              <SelectTrigger className="w-full">
                <SelectValue placeholder="Select branch..." />
              </SelectTrigger>
              <SelectContent>
                {branches.map((b) => (
                  <SelectItem key={b.id} value={b.id}>
                    {b.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setBranchAssignDialogOpen(false);
                setAssignToBranch("");
              }}
              disabled={isAssigningBranch}
            >
              Cancel
            </Button>
            <Button
              onClick={handleBulkAssignBranch}
              disabled={isAssigningBranch || !assignToBranch}
            >
              {isAssigningBranch ? "Sharing…" : "Share"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Bulk Move to List Dialog */}
      <Dialog open={moveListDialogOpen} onOpenChange={(open) => {
        setMoveListDialogOpen(open);
        if (!open) { setMoveListId(""); setMoveArchiveReason(""); }
      }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Move {selectedCount} lead{selectedCount !== 1 ? "s" : ""} to list</DialogTitle>
            <DialogDescription>
              Select a target list. Leads will be moved out of their current list.
            </DialogDescription>
          </DialogHeader>
          <div className="py-4 space-y-3">
            <Select value={moveListId} onValueChange={(v) => { setMoveListId(v); setMoveArchiveReason(""); }}>
              <SelectTrigger className="w-full">
                <SelectValue placeholder="Select list..." />
              </SelectTrigger>
              <SelectContent>
                {leadLists.map((l) => (
                  <SelectItem key={l.id} value={l.id}>
                    {l.name}{l.is_archive ? " (Archive)" : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {moveTargetIsArchive && (
              <div className="space-y-1.5">
                <p className="text-sm font-medium text-gray-700">Archive reason</p>
                <Select value={moveArchiveReason} onValueChange={setMoveArchiveReason}>
                  <SelectTrigger className="w-full">
                    <SelectValue placeholder="Select reason..." />
                  </SelectTrigger>
                  <SelectContent>
                    {["Not interested", "Wrong number", "Not reachable", "Already enrolled elsewhere", "Other"].map((r) => (
                      <SelectItem key={r} value={r}>{r}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => { setMoveListDialogOpen(false); setMoveListId(""); setMoveArchiveReason(""); }}
              disabled={isMoveList}
            >
              Cancel
            </Button>
            <Button
              onClick={handleBulkMove}
              disabled={isMoveList || !moveListId || (moveTargetIsArchive && !moveArchiveReason)}
            >
              {isMoveList ? "Moving…" : "Move"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Merge Dialog — shown when exactly 2 leads are selected */}
      {isAdmin && mergeDialogOpen && selectedCount === 2 && (() => {
        const [idA, idB] = Array.from(selectedIds);
        const leadA = localLeads.find((l) => l.id === idA);
        const leadB = localLeads.find((l) => l.id === idB);
        if (!leadA || !leadB) return null;
        return (
          <MergeDialog
            leadA={leadA}
            leadB={leadB}
            open={mergeDialogOpen}
            onOpenChange={setMergeDialogOpen}
            onMerged={() => {
              setSelectedIds(new Set());
              setMergeDialogOpen(false);
            }}
          />
        );
      })()}

      {/* Add Lead Sheet */}
      {canCreateLead && tenantId && (
        <AddLeadSheet
          open={addLeadOpen}
          onOpenChange={setAddLeadOpen}
          tenantId={tenantId}
          stages={stages}
          teamMembers={teamMembers}
          entities={entities}
          entityLabel={entityLabel}
          role={role}
          currentUserId={currentUserId}
          industryId={industryId}
          branches={branches}
          selectedBranchId={selectedBranchId}
          userBranchId={userBranchId}
        />
      )}

      {/* Column Manager Dialog */}
      <ColumnManagerDialog
        open={columnDialogOpen}
        onOpenChange={setColumnDialogOpen}
        allColumns={allColumns}
        currentMiddleKeys={visibleKeys}
        defaultMiddleKeys={defaultMiddleKeys}
        onApply={handleColumnApply}
        onReset={handleColumnReset}
      />
    </div>
  );
}
