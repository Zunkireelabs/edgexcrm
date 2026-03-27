"use client";

import { useState, useMemo } from "react";
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
import {
  Download,
  Search,
  Trash2,
  Eye,
} from "lucide-react";
import { toast } from "sonner";
import type { Lead, PipelineStage } from "@/types/database";

interface LeadsTableProps {
  leads: Lead[];
  memberMap?: Record<string, string>;
  stages?: PipelineStage[];
  formMap?: Record<string, string>;
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

export function LeadsTable({ leads, memberMap = {}, stages = [], formMap = {} }: LeadsTableProps) {
  const router = useRouter();
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [formFilter, setFormFilter] = useState<string>("all");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  const formEntries = useMemo(() => Object.entries(formMap), [formMap]);
  const hasMultipleForms = formEntries.length > 1;

  const filtered = useMemo(() => {
    return leads.filter((lead) => {
      const matchesStatus =
        statusFilter === "all" || lead.status === statusFilter;
      const matchesForm =
        formFilter === "all" || lead.form_config_id === formFilter;
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
      return matchesStatus && matchesSearch && matchesForm;
    });
  }, [leads, search, statusFilter, formFilter, memberMap]);

  const filteredIds = useMemo(() => new Set(filtered.map((l) => l.id)), [filtered]);

  const selectedCount = selectedIds.size;
  const allSelected = filtered.length > 0 && filtered.every((l) => selectedIds.has(l.id));
  const someSelected = filtered.some((l) => selectedIds.has(l.id)) && !allSelected;

  function toggleSelectAll() {
    if (allSelected) {
      setSelectedIds((prev) => {
        const next = new Set(prev);
        filtered.forEach((l) => next.delete(l.id));
        return next;
      });
    } else {
      setSelectedIds((prev) => {
        const next = new Set(prev);
        filtered.forEach((l) => next.add(l.id));
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

      {/* Header Bar with Search, Filters, Actions */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3">
        {/* Lead count */}
        <div className="text-sm font-medium text-gray-500 shrink-0">
          {filtered.length} Leads
        </div>

        {/* Search - edge-flow style */}
        <div className="relative flex-1 w-full sm:max-w-sm">
          <div className="flex items-center bg-white rounded-xl px-4 py-2 border border-gray-300 focus-within:border-blue-400 focus-within:ring-2 focus-within:ring-blue-100 transition-all">
            <Search className="w-4 h-4 text-gray-500 mr-3" />
            <input
              type="text"
              placeholder="Search leads..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              className="bg-transparent w-full text-sm outline-none text-gray-700 placeholder-gray-500"
            />
          </div>
        </div>

        {/* Filters */}
        <div className="flex items-center gap-2">
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-[130px] h-9 bg-white border-gray-300">
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
          {hasMultipleForms && (
            <Select value={formFilter} onValueChange={setFormFilter}>
              <SelectTrigger className="w-[150px] h-9 bg-white border-gray-300">
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
        </div>

        {/* Actions */}
        <Button variant="outline" size="sm" onClick={exportCSV} className="h-9">
          <Download className="h-4 w-4 mr-2" />
          Export
        </Button>
      </div>

      {/* Table - Databricks style */}
      <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
        <table className="w-full min-w-full">
          <thead>
            <tr className="border-b border-gray-100 bg-gray-50/50">
              <th className="px-4 py-3 text-left w-12">
                <Checkbox
                  checked={someSelected ? "indeterminate" : allSelected}
                  onCheckedChange={toggleSelectAll}
                  aria-label="Select all"
                />
              </th>
              <th className="px-4 py-3 text-left w-12"></th>
              <th className="px-4 py-3 text-left text-sm font-normal text-gray-500">Name</th>
              <th className="px-4 py-3 text-left text-sm font-normal text-gray-500 hidden md:table-cell">Email</th>
              <th className="px-4 py-3 text-left text-sm font-normal text-gray-500 hidden lg:table-cell">Location</th>
              <th className="px-4 py-3 text-left text-sm font-normal text-gray-500 hidden lg:table-cell">Assigned</th>
              <th className="px-4 py-3 text-left text-sm font-normal text-gray-500">Status</th>
              {hasMultipleForms && (
                <th className="px-4 py-3 text-left text-sm font-normal text-gray-500 hidden md:table-cell">Form</th>
              )}
              <th className="px-4 py-3 text-left text-sm font-normal text-gray-500 hidden md:table-cell">Date</th>
              <th className="px-4 py-3 text-right text-sm font-normal text-gray-500 w-24">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50">
            {filtered.length === 0 ? (
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
              filtered.map((lead) => {
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
                    <td className="px-4 py-3" onClick={(e) => e.stopPropagation()}>
                      <Checkbox
                        checked={isSelected}
                        onCheckedChange={() => toggleSelect(lead.id)}
                        aria-label={`Select ${lead.first_name} ${lead.last_name}`}
                      />
                    </td>
                    <td className="px-4 py-3">
                      <div
                        className={`h-8 w-8 rounded-full flex items-center justify-center text-white text-sm font-medium ${avatarColor}`}
                      >
                        {initials}
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <Link
                        href={`/leads/${lead.id}`}
                        className="text-sm font-normal text-[#2272B4] hover:underline"
                      >
                        {lead.first_name} {lead.last_name}
                      </Link>
                      <div className="text-xs text-gray-500 md:hidden">
                        {lead.email}
                      </div>
                    </td>
                    <td className="px-4 py-3 hidden md:table-cell text-sm text-gray-600">
                      {lead.email}
                    </td>
                    <td className="px-4 py-3 hidden lg:table-cell text-sm text-gray-600">
                      {lead.city || <span className="text-gray-400">—</span>}
                    </td>
                    <td className="px-4 py-3 hidden lg:table-cell text-sm text-gray-600">
                      {assignedEmail ? (
                        <span>{assignedEmail.split("@")[0]}</span>
                      ) : (
                        <span className="text-gray-400">—</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
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
                            className={`inline-flex items-center px-2 py-1 rounded-full text-xs font-medium ${
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
                      <td className="px-4 py-3 hidden md:table-cell">
                        {formName ? (
                          <span className="text-xs px-2 py-1 rounded-full bg-gray-100 text-gray-800">
                            {formName}
                          </span>
                        ) : (
                          <span className="text-gray-400">—</span>
                        )}
                      </td>
                    )}
                    <td className="px-4 py-3 hidden md:table-cell text-sm text-gray-500">
                      {new Date(lead.created_at).toLocaleDateString()}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <div className="flex items-center justify-end gap-1">
                        <Link
                          href={`/leads/${lead.id}`}
                          className="p-1.5 rounded hover:bg-gray-100 text-gray-400 hover:text-gray-600 transition-colors"
                        >
                          <Eye size={16} />
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
      <p className="text-xs text-gray-500">
        Showing {filtered.length} of {leads.length} leads
      </p>

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
