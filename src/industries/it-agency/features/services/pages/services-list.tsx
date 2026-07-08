"use client";

import { useState, useEffect, useRef, useMemo } from "react";
import { toast } from "sonner";
import {
  Plus, Package, Loader2, Pencil, Trash2, Search,
  ArrowUpDown, ChevronLeft, ChevronRight,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { FilterMenu, FilterChips, type FilterDef } from "@/components/ui/filter-menu";
import { Popover, PopoverTrigger, PopoverContent } from "@/components/ui/popover";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";
import { ServiceForm } from "../components/service-form";
import type { Service } from "@/types/database";

interface ServicesListPageProps {
  tenantId: string;
  role: string;
}

type SortField = "name" | "created" | "price";
type SortDirection = "asc" | "desc";

const BILLING_TYPE_LABEL: Record<Service["billing_type"], string> = {
  fixed: "Fixed",
  hourly: "Hourly",
  retainer: "Retainer",
};

function formatNumber(value: number | null): string {
  if (value === null) return "—";
  return value.toLocaleString(undefined, { maximumFractionDigits: 2 });
}

export function ServicesListPage({ role }: ServicesListPageProps) {
  const isAdmin = role === "owner" || role === "admin";
  const [services, setServices] = useState<Service[]>([]);
  const [loading, setLoading] = useState(true);
  const [createOpen, setCreateOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<Service | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Service | null>(null);
  const [deleting, setDeleting] = useState(false);

  const [searchInput, setSearchInput] = useState("");
  const [debouncedQ, setDebouncedQ] = useState("");
  const [filterStatus, setFilterStatus] = useState<"active" | "inactive" | "all">("active");

  const [sortField, setSortField] = useState<SortField>("name");
  const [sortDirection, setSortDirection] = useState<SortDirection>("asc");

  const [currentPage, setCurrentPage] = useState(1);
  const [itemsPerPage, setItemsPerPage] = useState(25);

  const debounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (debounceTimer.current) clearTimeout(debounceTimer.current);
    debounceTimer.current = setTimeout(() => setDebouncedQ(searchInput), 250);
    return () => {
      if (debounceTimer.current) clearTimeout(debounceTimer.current);
    };
  }, [searchInput]);

  useEffect(() => {
    fetch("/api/v1/services")
      .then((r) => r.json())
      .then(({ data }) => setServices(data ?? []))
      .catch(() => toast.error("Failed to load services"))
      .finally(() => setLoading(false));
  }, []);

  function handleCreated(service: Service) {
    setServices((prev) => [service, ...prev]);
  }

  function handleUpdated(service: Service) {
    setServices((prev) => prev.map((s) => (s.id === service.id ? service : s)));
  }

  async function handleDelete(service: Service) {
    setDeleting(true);
    try {
      const res = await fetch(`/api/v1/services/${service.id}`, { method: "DELETE" });
      if (!res.ok) throw new Error("Failed to delete service");
      toast.success("Service deleted");
      setServices((prev) => prev.filter((s) => s.id !== service.id));
      setDeleteTarget(null);
    } catch {
      toast.error("Failed to delete service");
    } finally {
      setDeleting(false);
    }
  }

  const activeFiltersCount = [
    searchInput !== "",
    filterStatus !== "active",
  ].filter(Boolean).length;

  function clearFilters() {
    setSearchInput("");
    setFilterStatus("active");
    setCurrentPage(1);
  }

  const filtered = useMemo(() => {
    return services.filter((s) => {
      if (filterStatus === "active" && !s.is_active) return false;
      if (filterStatus === "inactive" && s.is_active) return false;
      if (debouncedQ) {
        const q = debouncedQ.toLowerCase();
        const matchesName = s.name.toLowerCase().includes(q);
        const matchesCategory = (s.category ?? "").toLowerCase().includes(q);
        if (!matchesName && !matchesCategory) return false;
      }
      return true;
    });
  }, [services, debouncedQ, filterStatus]);

  const sorted = useMemo(() => {
    const result = [...filtered];
    result.sort((a, b) => {
      let cmp = 0;
      switch (sortField) {
        case "name":
          cmp = a.name.toLowerCase().localeCompare(b.name.toLowerCase());
          break;
        case "created":
          cmp = new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
          break;
        case "price":
          cmp = (a.price ?? 0) - (b.price ?? 0);
          break;
      }
      return sortDirection === "asc" ? cmp : -cmp;
    });
    return result;
  }, [filtered, sortField, sortDirection]);

  const totalPages = Math.ceil(sorted.length / itemsPerPage);
  const safePage = totalPages > 0 ? Math.min(currentPage, totalPages) : 1;
  const startIndex = (safePage - 1) * itemsPerPage;
  const endIndex = Math.min(startIndex + itemsPerPage, sorted.length);
  const paginatedServices = useMemo(
    () => sorted.slice(startIndex, endIndex),
    [sorted, startIndex, endIndex]
  );

  const filterDefs: FilterDef[] = [
    {
      id: "status",
      label: "Status",
      multiple: false,
      searchable: false,
      defaultValue: "active",
      value: filterStatus,
      onChange: (val: string) => { setFilterStatus(val as typeof filterStatus); setCurrentPage(1); },
      options: [
        { value: "active", label: "Active", description: "Active services only" },
        { value: "inactive", label: "Inactive", description: "Inactive services only" },
        { value: "all", label: "All Statuses", description: "Show every service" },
      ],
    },
  ];

  if (loading) {
    return (
      <div className="flex items-center justify-center h-48">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  return (
    <div className="flex flex-1 min-h-0 gap-0">
      <div className="flex flex-col flex-1 min-h-0 min-w-0 gap-1 overflow-hidden pr-6">
        <h1 className="shrink-0 text-lg font-bold mb-4">Services</h1>

        {services.length === 0 ? (
          <div className="border rounded-xl p-12 text-center bg-background">
            <Package className="h-10 w-10 text-muted-foreground mx-auto mb-4" />
            <h3 className="font-semibold text-lg mb-1">No services yet</h3>
            <p className="text-muted-foreground text-sm mb-6">
              Add your first service package to build out your catalog.
            </p>
            {isAdmin && (
              <Button onClick={() => setCreateOpen(true)}>
                <Plus className="h-4 w-4 mr-2" />
                Create your first service
              </Button>
            )}
          </div>
        ) : (
          <>
            {/* Toolbar card */}
            <div className="shrink-0">
              <div className="flex flex-wrap items-center gap-3 p-3">
                <div className="text-sm font-medium text-muted-foreground shrink-0">
                  {sorted.length} Services
                </div>

                <div className="relative w-60">
                  <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3 w-3 text-gray-400" />
                  <input
                    type="text"
                    placeholder="Search by name or category…"
                    value={searchInput}
                    onChange={(e) => { setSearchInput(e.target.value); setCurrentPage(1); }}
                    className="w-full h-7 pl-7 pr-3 rounded-md border border-gray-300 bg-white text-xs text-gray-600 placeholder:text-gray-400 outline-none focus:ring-1 focus:ring-ring"
                  />
                </div>

                <div className="flex-1" />

                <FilterMenu filters={filterDefs} activeCount={activeFiltersCount} onClearAll={clearFilters} />

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
                        <Select
                          value={sortField}
                          onValueChange={(v) => { setSortField(v as SortField); setCurrentPage(1); }}
                        >
                          <SelectTrigger className="flex-1 h-9">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="name">Name</SelectItem>
                            <SelectItem value="created">Date created</SelectItem>
                            <SelectItem value="price">Price</SelectItem>
                          </SelectContent>
                        </Select>
                        <div className="flex rounded-md border shrink-0">
                          <button
                            type="button"
                            onClick={() => { setSortDirection("desc"); setCurrentPage(1); }}
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
                            onClick={() => { setSortDirection("asc"); setCurrentPage(1); }}
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

                {isAdmin && (
                  <button
                    type="button"
                    onClick={() => setCreateOpen(true)}
                    className="inline-flex items-center gap-1.5 h-7 px-2.5 text-xs font-medium rounded-md transition-colors bg-[#0f0f10] text-white hover:bg-[#0f0f10]/90"
                  >
                    <Plus className="h-3 w-3 shrink-0" />
                    New Service
                  </button>
                )}
              </div>

              {activeFiltersCount > 0 && <FilterChips filters={filterDefs} onClearAll={clearFilters} />}
            </div>

            {/* Table card */}
            <div className="flex-1 min-h-0 bg-white rounded-[0.75rem] border border-gray-200 flex flex-col overflow-hidden">
              <div className="flex-1 min-h-0 overflow-auto">
                <table className="w-full">
                  <thead className="sticky top-0 z-10">
                    <tr className="border-b border-gray-200 bg-gray-50">
                      <th className="px-3 py-2 text-left text-xs font-medium text-gray-600">Name</th>
                      <th className="px-3 py-2 text-left text-xs font-medium text-gray-600">Category</th>
                      <th className="px-3 py-2 text-left text-xs font-medium text-gray-600 w-24">Billing</th>
                      <th className="px-3 py-2 text-left text-xs font-medium text-gray-600 w-20">Hours</th>
                      <th className="px-3 py-2 text-left text-xs font-medium text-gray-600 w-28">Price</th>
                      <th className="px-3 py-2 text-left text-xs font-medium text-gray-600 w-24">Status</th>
                      {isAdmin && (
                        <th className="px-3 py-2 text-right text-xs font-medium text-gray-600 w-24">Actions</th>
                      )}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {paginatedServices.map((service) => (
                      <tr key={service.id} className="hover:bg-gray-50 transition-colors">
                        <td className="px-3 py-1.5">
                          <span className="text-sm font-medium text-[#0f0f10]">{service.name}</span>
                        </td>
                        <td className="px-3 py-1.5 text-sm font-normal text-[#787871]">
                          {service.category ?? <span className="text-gray-400">—</span>}
                        </td>
                        <td className="px-3 py-1.5">
                          <Badge variant="outline" className="bg-gray-50 text-gray-700 border-gray-200">
                            {BILLING_TYPE_LABEL[service.billing_type]}
                          </Badge>
                        </td>
                        <td className="px-3 py-1.5 text-sm font-normal text-[#787871]">
                          {formatNumber(service.hours)}
                        </td>
                        <td className="px-3 py-1.5 text-sm font-normal text-[#787871]">
                          {formatNumber(service.price)}
                        </td>
                        <td className="px-3 py-1.5">
                          <Badge
                            variant="outline"
                            className={
                              service.is_active
                                ? "bg-green-50 text-green-700 border-green-200"
                                : "bg-gray-100 text-gray-500 border-gray-200"
                            }
                          >
                            {service.is_active ? "Active" : "Inactive"}
                          </Badge>
                        </td>
                        {isAdmin && (
                          <td className="px-3 py-1.5 text-right">
                            <div className="flex items-center justify-end gap-1">
                              <Button
                                variant="ghost"
                                size="sm"
                                className="h-8 w-8 p-0"
                                onClick={() => setEditTarget(service)}
                              >
                                <Pencil className="h-3.5 w-3.5" />
                              </Button>
                              <Button
                                variant="ghost"
                                size="sm"
                                className="h-8 w-8 p-0 text-muted-foreground hover:text-destructive"
                                onClick={() => setDeleteTarget(service)}
                              >
                                <Trash2 className="h-3.5 w-3.5" />
                              </Button>
                            </div>
                          </td>
                        )}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Pagination footer */}
              <div className="shrink-0 flex justify-between items-center px-3 py-2 border-t border-gray-100">
                <span className="text-xs text-gray-500">
                  Showing {sorted.length === 0 ? 0 : startIndex + 1}-{endIndex} of {sorted.length}
                </span>
                <div className="flex items-center gap-4">
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
                  <div className="flex items-center gap-1">
                    <button
                      disabled={safePage <= 1}
                      onClick={() => setCurrentPage((p) => p - 1)}
                      className="p-1 rounded hover:bg-gray-100 text-gray-500 hover:text-gray-700 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                    >
                      <ChevronLeft className="w-4 h-4" />
                    </button>
                    <span className="text-xs text-gray-600 px-2">
                      Page {safePage} of {totalPages || 1}
                    </span>
                    <button
                      disabled={safePage >= totalPages}
                      onClick={() => setCurrentPage((p) => p + 1)}
                      className="p-1 rounded hover:bg-gray-100 text-gray-500 hover:text-gray-700 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                    >
                      <ChevronRight className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              </div>
            </div>
          </>
        )}
      </div>

      {/* Create dialog */}
      <ServiceForm
        open={createOpen}
        onOpenChange={setCreateOpen}
        onSuccess={handleCreated}
      />

      {/* Edit dialog */}
      {editTarget && (
        <ServiceForm
          service={editTarget}
          open={Boolean(editTarget)}
          onOpenChange={(open) => !open && setEditTarget(null)}
          onSuccess={handleUpdated}
        />
      )}

      {/* Delete confirmation */}
      <Dialog
        open={Boolean(deleteTarget)}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete Service</DialogTitle>
            <DialogDescription>
              Are you sure you want to delete &quot;{deleteTarget?.name}&quot;? This cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteTarget(null)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              disabled={deleting}
              onClick={() => deleteTarget && handleDelete(deleteTarget)}
            >
              {deleting && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
