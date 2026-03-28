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
  ChevronsLeft,
  ChevronsRight,
} from "lucide-react";
import { toast } from "sonner";
import type { Lead, PipelineStage, UserRole } from "@/types/database";

type SortField = "created" | "updated" | "name" | "email";
type SortDirection = "asc" | "desc";

interface LeadsTableProps {
  leads: Lead[];
  memberMap?: Record<string, string>;
  stages?: PipelineStage[];
  formMap?: Record<string, string>;
  role?: UserRole;
}

// Generate consistent color from string
function stringToColor(str: string): string {
  const colors = [
    "bg-blue-600",
    "bg-purple-600",
    "bg-pink-600",
    "bg-orange-600",
    "bg-green-600",
    "bg-indigo-600",
    "bg-rose-600",
    "bg-cyan-600",
    "bg-amber-600",
    "bg-teal-600",
  ];
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = str.charCodeAt(i) + ((hash << 5) - hash);
  }
  return colors[Math.abs(hash) % colors.length];
}

function getInitials(firstName?: string | null, lastName?: string | null): string {
  const first = firstName?.charAt(0)?.toUpperCase() || "";
  const last = lastName?.charAt(0)?.toUpperCase() || "";
  return first + last || "?";
}

export function LeadsTable({ leads, memberMap = {}, stages = [], formMap = {}, role = "viewer" }: LeadsTableProps) {
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

  // Pagination state
  const [currentPage, setCurrentPage] = useState(1);
  const [itemsPerPage, setItemsPerPage] = useState(25);

  const isAdmin = role === "admin" || role === "owner";

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

  return (
    <div className="space-y-4">
      {/* Bulk Action Bar */}
      {selectedCount > 0 && (
        <div className="flex items-center justify-between bg-blue-50 border border-blue-200 rounded-lg px-4 py-3">
          <span className="text-sm font-medium text-blue-700">
            {selectedCount} lead{selectedCount !== 1 ? "s" : ""} selected
          </span>
          <Button
            variant="destructive"
            size="sm"
            onClick={() => setDeleteDialogOpen(true)}
          >
            <Trash2 className="h-4 w-4 mr-2" />
            Delete
          </Button>
        </div>
      )}

      {/* Enhanced Toolbar - matching pipeline style */}
      <div className="bg-card rounded-lg border">
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
        </div>

        {/* Divider */}
        <div className="h-px bg-border" />

        {/* Filter Row - Compact */}
        <div className="flex flex-wrap items-center gap-1.5 px-3 py-2">
          {/* Counselor Filter (Admin only) */}
          {isAdmin && counselors.length > 0 && (
            <Select value={counselorFilter} onValueChange={setCounselorFilter}>
              <SelectTrigger className={`h-7 text-xs px-2.5 ${counselorFilter !== "all" ? "border-[#2272B4] bg-blue-50 text-[#2272B4]" : ""}`}>
                <div className="flex items-center gap-1.5">
                  <Users2 className="h-3 w-3" />
                  <SelectValue placeholder="Counselor" />
                </div>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Counselors</SelectItem>
                <SelectItem value="unassigned">Unassigned</SelectItem>
                {counselors.map(([userId, email]) => (
                  <SelectItem key={userId} value={userId}>
                    {email.split("@")[0]}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}

          {/* Source Filter */}
          {sources.length > 0 && (
            <Select value={sourceFilter} onValueChange={setSourceFilter}>
              <SelectTrigger className={`h-7 text-xs px-2.5 ${sourceFilter !== "all" ? "border-[#2272B4] bg-blue-50 text-[#2272B4]" : ""}`}>
                <div className="flex items-center gap-1.5">
                  <Globe className="h-3 w-3" />
                  <SelectValue placeholder="Source" />
                </div>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Sources</SelectItem>
                {sources.map(s => (
                  <SelectItem key={s} value={s}>{s}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}

          {/* Created Date Filter */}
          <Select value={createdFilter} onValueChange={setCreatedFilter}>
            <SelectTrigger className={`h-7 text-xs px-2.5 ${createdFilter !== "all" ? "border-[#2272B4] bg-blue-50 text-[#2272B4]" : ""}`}>
              <div className="flex items-center gap-1.5">
                <Calendar className="h-3 w-3" />
                <SelectValue placeholder="Created" />
              </div>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Any time</SelectItem>
              <SelectItem value="today">Today</SelectItem>
              <SelectItem value="week">Last 7 days</SelectItem>
              <SelectItem value="month">Last 30 days</SelectItem>
            </SelectContent>
          </Select>

          {/* Status Filter */}
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className={`h-7 text-xs px-2.5 ${statusFilter !== "all" ? "border-[#2272B4] bg-blue-50 text-[#2272B4]" : ""}`}>
              <SelectValue placeholder="All Status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Status</SelectItem>
              <SelectItem value="new">New</SelectItem>
              <SelectItem value="partial">Partial</SelectItem>
              <SelectItem value="contacted">Contacted</SelectItem>
              <SelectItem value="enrolled">Enrolled</SelectItem>
              <SelectItem value="rejected">Rejected</SelectItem>
            </SelectContent>
          </Select>

          {/* Form Filter (if multiple forms) */}
          {hasMultipleForms && (
            <Select value={formFilter} onValueChange={setFormFilter}>
              <SelectTrigger className={`h-7 text-xs px-2.5 ${formFilter !== "all" ? "border-[#2272B4] bg-blue-50 text-[#2272B4]" : ""}`}>
                <SelectValue placeholder="All Forms" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Forms</SelectItem>
                {formEntries.map(([id, name]) => (
                  <SelectItem key={id} value={id}>
                    {name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
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

      {/* Table - Compact style */}
      <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
        <table className="w-full min-w-full">
          <thead>
            <tr className="border-b border-gray-200 bg-gray-50/80">
              <th className="px-3 py-2 text-left w-10">
                <Checkbox
                  checked={someSelected ? "indeterminate" : allSelected}
                  onCheckedChange={toggleSelectAll}
                  aria-label="Select all"
                />
              </th>
              <th className="px-2 py-2 text-left w-8"></th>
              <th className="px-3 py-2 text-left text-xs font-medium text-gray-600">Name</th>
              <th className="px-3 py-2 text-left text-xs font-medium text-gray-600 hidden md:table-cell">Email</th>
              <th className="px-3 py-2 text-left text-xs font-medium text-gray-600 hidden lg:table-cell">Location</th>
              <th className="px-3 py-2 text-left text-xs font-medium text-gray-600 hidden lg:table-cell">Assigned</th>
              <th className="px-3 py-2 text-left text-xs font-medium text-gray-600">Status</th>
              {hasMultipleForms && (
                <th className="px-3 py-2 text-left text-xs font-medium text-gray-600 hidden md:table-cell">Form</th>
              )}
              <th className="px-3 py-2 text-left text-xs font-medium text-gray-600 hidden md:table-cell">Date</th>
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
                const avatarColor = stringToColor(`${lead.first_name}${lead.last_name}${lead.email}`);
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
                      <div
                        className={`h-6 w-6 rounded-full flex items-center justify-center text-white text-xs font-medium ${avatarColor}`}
                      >
                        {initials}
                      </div>
                    </td>
                    <td className="px-3 py-1.5">
                      <Link
                        href={`/leads/${lead.id}`}
                        className="text-sm font-medium text-[#2272B4] hover:underline"
                      >
                        {lead.first_name} {lead.last_name}
                      </Link>
                      <div className="text-xs text-gray-500 md:hidden">
                        {lead.email}
                      </div>
                    </td>
                    <td className="px-3 py-1.5 hidden md:table-cell text-sm text-gray-500 font-light">
                      {lead.email}
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
                            className={`inline-flex items-center px-2 py-0.5 rounded-full text-xs font-medium ${
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
                      <td className="px-3 py-1.5 hidden md:table-cell">
                        {formName ? (
                          <span className="text-xs px-2 py-0.5 rounded-full bg-gray-100 text-gray-700">
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
      {/* Pagination Controls */}
      <div className="flex items-center justify-between py-3 px-1">
        <p className="text-xs text-gray-500">
          Showing {filtered.length === 0 ? 0 : startIndex + 1} to {endIndex} of {filtered.length}
        </p>

        <div className="flex items-center gap-4">
          {/* Items per page */}
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
              onClick={() => setCurrentPage(1)}
              disabled={currentPage === 1}
              className="p-1 rounded hover:bg-gray-100 text-gray-500 hover:text-gray-700 disabled:opacity-30 disabled:hover:bg-transparent disabled:cursor-not-allowed transition-colors"
              title="First page"
            >
              <ChevronsLeft className="h-4 w-4" />
            </button>
            <button
              onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
              disabled={currentPage === 1}
              className="p-1 rounded hover:bg-gray-100 text-gray-500 hover:text-gray-700 disabled:opacity-30 disabled:hover:bg-transparent disabled:cursor-not-allowed transition-colors"
              title="Previous page"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>

            <span className="text-xs text-gray-600 px-2">
              Page {currentPage} of {totalPages || 1}
            </span>

            <button
              onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
              disabled={currentPage >= totalPages}
              className="p-1 rounded hover:bg-gray-100 text-gray-500 hover:text-gray-700 disabled:opacity-30 disabled:hover:bg-transparent disabled:cursor-not-allowed transition-colors"
              title="Next page"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
            <button
              onClick={() => setCurrentPage(totalPages)}
              disabled={currentPage >= totalPages}
              className="p-1 rounded hover:bg-gray-100 text-gray-500 hover:text-gray-700 disabled:opacity-30 disabled:hover:bg-transparent disabled:cursor-not-allowed transition-colors"
              title="Last page"
            >
              <ChevronsRight className="h-4 w-4" />
            </button>
          </div>
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
    </div>
  );
}
