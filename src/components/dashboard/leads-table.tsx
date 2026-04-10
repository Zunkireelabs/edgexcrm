"use client";

import { useState, useMemo, useEffect } from "react";
import Link from "next/link";
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
  Eye,
  Users2,
  Globe,
  Calendar,
  ArrowUpDown,
  X,
  ChevronLeft,
  ChevronRight,
  Plus,
  UserPlus,
} from "lucide-react";
import { toast } from "sonner";
import { AddLeadSheet } from "@/components/dashboard/add-lead-sheet";
import { LeadPreviewPanel } from "@/components/dashboard/lead-preview-panel";
import type { Lead, PipelineStage, UserRole, TenantEntity } from "@/types/database";
import { TruncatedText } from "@/components/ui/truncated-text";

type SortField = "created" | "updated" | "name" | "email";
type SortDirection = "asc" | "desc";

// Column width constants for consistent sizing
const NAME_COLUMN_WIDTH = 180;
const EMAIL_COLUMN_WIDTH = 200;
const EMAIL_MOBILE_WIDTH = 140;
// Note: Preview button padding (72px) is defined in Tailwind class `group-hover/name:pr-[72px]`

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
}: LeadsTableProps) {
  const router = useRouter();
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [formFilter, setFormFilter] = useState<string>("all");
  const [counselorFilter, setCounselorFilter] = useState<string>("all");
  const [sourceFilter, setSourceFilter] = useState<string>("all");
  const [createdFilter, setCreatedFilter] = useState<string>("all");
  const [sortField, setSortField] = useState<SortField>("created");
  const [sortDirection, setSortDirection] = useState<SortDirection>("desc");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [assignDialogOpen, setAssignDialogOpen] = useState(false);
  const [isAssigning, setIsAssigning] = useState(false);
  const [assignTo, setAssignTo] = useState<string>("");
  const [addLeadOpen, setAddLeadOpen] = useState(false);
  const [previewLeadId, setPreviewLeadId] = useState<string | null>(null);

  // Pagination state
  const [currentPage, setCurrentPage] = useState(1);
  const [itemsPerPage, setItemsPerPage] = useState(25);

  const isAdmin = role === "admin" || role === "owner";
  const canCreateLead = role !== "viewer";

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

    let result = leads.filter((lead) => {
      const matchesStatus =
        statusFilter === "all" || lead.status === statusFilter;
      const matchesForm =
        formFilter === "all" || lead.form_config_id === formFilter;
      const matchesCounselor =
        counselorFilter === "all" ||
        (counselorFilter === "unassigned" ? !lead.assigned_to : lead.assigned_to === counselorFilter);
      const matchesSource =
        sourceFilter === "all" || lead.intake_source === sourceFilter;

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
      return matchesStatus && matchesSearch && matchesForm && matchesCounselor && matchesSource && matchesCreated;
    });

    // Apply sorting
    result = [...result].sort((a, b) => {
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

    return result;
  }, [leads, search, statusFilter, formFilter, counselorFilter, sourceFilter, createdFilter, sortField, sortDirection, memberMap]);

  const clearFilters = () => {
    setSearch("");
    setStatusFilter("all");
    setFormFilter("all");
    setCounselorFilter("all");
    setSourceFilter("all");
    setCreatedFilter("all");
    setCurrentPage(1);
  };

  const activeFiltersCount = [
    search !== "",
    statusFilter !== "all",
    formFilter !== "all",
    counselorFilter !== "all",
    sourceFilter !== "all",
    createdFilter !== "all"
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

  function exportCSV() {
    const headers = [
      "Date",
      "First Name",
      "Last Name",
      "Email",
      "Phone",
      "City",
      "Country",
      "Status",
      "Assigned To",
      ...(hasMultipleForms ? ["Form"] : []),
    ];
    const rows = filtered.map((l) => [
      new Date(l.created_at).toLocaleDateString(),
      l.first_name || "",
      l.last_name || "",
      l.email || "",
      l.phone || "",
      l.city || "",
      l.country || "",
      l.status,
      l.assigned_to ? memberMap[l.assigned_to] || "" : "",
      ...(hasMultipleForms ? [l.form_config_id ? formMap[l.form_config_id] || "" : ""] : []),
    ]);
    const csv = [headers, ...rows].map((r) => r.map((c) => `"${c}"`).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `leads-${new Date().toISOString().split("T")[0]}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  const previewLead = leads.find((l) => l.id === previewLeadId) || null;

  return (
    <div className="flex flex-1 min-h-0 gap-0">
      {/* Main Table Section - shrinks when preview is open */}
      <div className={`flex flex-col flex-1 min-h-0 min-w-0 gap-2 overflow-hidden transition-[padding] duration-500 ease-out ${previewLead ? 'pr-4' : 'pr-6'}`}>
        {/* Bulk Action Bar */}
      {selectedCount > 0 && (
        <div className="shrink-0 flex items-center justify-between bg-blue-50 border border-blue-200 rounded-lg px-4 py-3">
          <span className="text-sm font-medium text-blue-700">
            {selectedCount} lead{selectedCount !== 1 ? "s" : ""} selected
          </span>
          <div className="flex items-center gap-2">
            {isAdmin && teamMembers.length > 0 && (
              <Button
                variant="outline"
                size="sm"
                onClick={() => setAssignDialogOpen(true)}
                className="bg-white"
              >
                <UserPlus className="h-4 w-4 mr-2" />
                Assign to
              </Button>
            )}
            <Button
              variant="destructive"
              size="sm"
              onClick={() => setDeleteDialogOpen(true)}
            >
              <Trash2 className="h-4 w-4 mr-2" />
              Delete
            </Button>
          </div>
        </div>
      )}

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
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
            <input
              type="text"
              placeholder="Search leads..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="w-full h-9 pl-9 pr-3 rounded-md border border-input bg-background text-sm outline-none focus:ring-2 focus:ring-ring"
            />
          </div>

          <div className="flex-1" />

          {/* Sort */}
          <Popover>
            <PopoverTrigger asChild>
              <Button variant="outline" size="sm" className="h-9 gap-2">
                <ArrowUpDown className="h-4 w-4" />
                Sort
              </Button>
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

          {/* Export */}
          <Button variant="outline" size="sm" className="h-9 gap-2" onClick={exportCSV}>
            <Download className="h-4 w-4" />
            Export
          </Button>

          {/* Add Lead Button */}
          {canCreateLead && tenantId && (
            <Button size="sm" className="h-9 gap-2" onClick={() => setAddLeadOpen(true)}>
              <Plus className="h-4 w-4" />
              Add Lead
            </Button>
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

      {/* Table - Compact style with sticky header and horizontal scroll */}
      <div className="flex-1 min-h-0 bg-white rounded-lg border border-gray-200 flex flex-col overflow-hidden">
        <div className="flex-1 min-h-0 overflow-auto">
          <table className="w-full min-w-[900px]">
          <thead className="sticky top-0 z-10">
            <tr className="border-b border-gray-200 bg-gray-50">
              <th className="px-3 py-2 text-left w-10">
                <Checkbox
                  checked={someSelected ? "indeterminate" : allSelected}
                  onCheckedChange={toggleSelectAll}
                  aria-label="Select all"
                />
              </th>
              <th className="px-2 py-2 text-left w-8"></th>
              <th className="px-3 py-2 text-left text-xs font-medium text-gray-600 w-[200px]">Name</th>
              <th className="px-3 py-2 text-left text-xs font-medium text-gray-600 hidden md:table-cell w-[220px]">Email</th>
              <th className="px-3 py-2 text-left text-xs font-medium text-gray-600 hidden lg:table-cell min-w-[100px]">Location</th>
              <th className="px-3 py-2 text-left text-xs font-medium text-gray-600 hidden lg:table-cell min-w-[120px]">Assigned</th>
              <th className="px-3 py-2 text-left text-xs font-medium text-gray-600 min-w-[100px]">Status</th>
              {hasMultipleForms && (
                <th className="px-3 py-2 text-left text-xs font-medium text-gray-600 hidden md:table-cell min-w-[120px]">Form</th>
              )}
              <th className="px-3 py-2 text-left text-xs font-medium text-gray-600 hidden md:table-cell min-w-[90px]">Date</th>
              <th className="px-3 py-2 text-right text-xs font-medium text-gray-600 w-20">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {paginatedLeads.length === 0 ? (
              <tr>
                <td
                  colSpan={hasMultipleForms ? 10 : 9}
                  className="text-center py-12 text-gray-500"
                >
                  <p>No leads found</p>
                  <p className="text-sm mt-1">Try adjusting your search or filters</p>
                </td>
              </tr>
            ) : (
              paginatedLeads.map((lead) => {
                const assignedEmail = lead.assigned_to
                  ? memberMap[lead.assigned_to]
                  : null;
                const formName = lead.form_config_id
                  ? formMap[lead.form_config_id]
                  : null;
                const isSelected = selectedIds.has(lead.id);
                const initials = getInitials(lead.first_name, lead.last_name);

                return (
                  <tr
                    key={lead.id}
                    className={`hover:bg-gray-50 transition-colors ${isSelected ? "bg-blue-50" : ""}`}
                  >
                    <td className="px-3 py-1.5" onClick={(e) => e.stopPropagation()}>
                      <Checkbox
                        checked={isSelected}
                        onCheckedChange={() => toggleSelect(lead.id)}
                        aria-label={`Select ${lead.first_name} ${lead.last_name}`}
                      />
                    </td>
                    <td className="px-2 py-1.5">
                      <div className="h-6 w-6 rounded-full flex items-center justify-center bg-gray-100 border border-gray-300 text-gray-500 text-xs font-medium">
                        {initials}
                      </div>
                    </td>
                    <td className="px-3 py-1.5">
                      {/* Fixed width container for consistent Preview button alignment */}
                      <div className="group/name relative" style={{ width: NAME_COLUMN_WIDTH }}>
                        {/* Name link - padding increases on hover to make room for Preview button */}
                        <Link
                          href={`/leads/${lead.id}`}
                          className="text-sm font-medium text-[#2272B4] hover:underline block pr-0 group-hover/name:pr-[72px] transition-[padding] duration-100"
                        >
                          <TruncatedText
                            text={`${lead.first_name || ""} ${lead.last_name || ""}`.trim() || "—"}
                          />
                        </Link>
                        {/* Preview button - absolute positioned at right edge */}
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            setPreviewLeadId(prev => prev === lead.id ? null : lead.id);
                          }}
                          className="absolute right-0 top-1/2 -translate-y-1/2 opacity-0 group-hover/name:opacity-100 transition-opacity md:inline-flex hidden items-center gap-1 px-2 py-0.5 text-xs font-medium text-gray-600 bg-gray-100 hover:bg-gray-200 rounded border border-gray-200"
                        >
                          <Eye size={12} />
                          Preview
                        </button>
                      </div>
                      {/* Mobile: email + preview icon */}
                      <div className="flex items-center gap-2 md:hidden">
                        <div className="text-xs text-gray-500">
                          <TruncatedText text={lead.email || ""} maxWidth={EMAIL_MOBILE_WIDTH} />
                        </div>
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            setPreviewLeadId(prev => prev === lead.id ? null : lead.id);
                          }}
                          className="shrink-0 p-1 text-gray-400 hover:text-gray-600 hover:bg-gray-100 rounded"
                        >
                          <Eye size={14} />
                        </button>
                      </div>
                    </td>
                    <td className="px-3 py-1.5 hidden md:table-cell text-sm text-gray-500 font-light">
                      <TruncatedText text={lead.email || ""} maxWidth={EMAIL_COLUMN_WIDTH} />
                    </td>
                    <td className="px-3 py-1.5 hidden lg:table-cell text-sm text-gray-500 font-light">
                      {lead.city || <span className="text-gray-400">—</span>}
                    </td>
                    <td className="px-3 py-1.5 hidden lg:table-cell text-sm text-gray-500 font-light">
                      {assignedEmail ? (
                        <span>{assignedEmail.split("@")[0]}</span>
                      ) : (
                        <span className="text-gray-400">—</span>
                      )}
                    </td>
                    <td className="px-3 py-1.5">
                      {(() => {
                        const stage = stages.find((s) => s.id === lead.stage_id);
                        const badgeColors: Record<string, string> = {
                          new: "bg-blue-100 text-blue-800",
                          contacted: "bg-yellow-100 text-yellow-800",
                          enrolled: "bg-green-100 text-green-800",
                          rejected: "bg-red-100 text-red-800",
                        };
                        return (
                          <span
                            className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium whitespace-nowrap ${
                              stage
                                ? ""
                                : badgeColors[lead.status] || "bg-gray-100 text-gray-800"
                            }`}
                            style={
                              stage
                                ? { backgroundColor: `${stage.color}20`, color: stage.color }
                                : undefined
                            }
                          >
                            {stage?.name || lead.status}
                          </span>
                        );
                      })()}
                    </td>
                    {hasMultipleForms && (
                      <td className="px-3 py-1.5 hidden md:table-cell whitespace-nowrap">
                        {formName ? (
                          <span className="text-xs px-2 py-0.5 rounded-full bg-gray-100 text-gray-700 whitespace-nowrap">
                            {formName}
                          </span>
                        ) : (
                          <span className="text-gray-400">—</span>
                        )}
                      </td>
                    )}
                    <td className="px-3 py-1.5 hidden md:table-cell text-sm text-gray-500 font-light">
                      {new Date(lead.created_at).toLocaleDateString()}
                    </td>
                    <td className="px-3 py-1.5 text-right">
                      <div className="flex items-center justify-end gap-1">
                        <Link
                          href={`/leads/${lead.id}`}
                          className="p-1 rounded hover:bg-gray-100 text-gray-400 hover:text-gray-600 transition-colors"
                        >
                          <Eye size={15} />
                        </Link>
                      </div>
                    </td>
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
        />
      )}
    </div>
  );
}
