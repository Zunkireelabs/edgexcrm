"use client";

import { useState, useEffect, useRef, useMemo } from "react";
import Link from "next/link";
import { toast } from "sonner";
import {
  Plus, Building2, Loader2, Pencil, Trash2, Search,
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
import { AccountForm } from "../components/account-form";
import type { Account } from "@/types/database";

interface AccountWithCount extends Account {
  project_count: number;
}

interface AccountsListPageProps {
  tenantId: string;
  role: string;
}

type SortField = "name" | "created" | "projects";
type SortDirection = "asc" | "desc";

function getInitials(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) return "?";
  const words = trimmed.split(/\s+/);
  if (words.length >= 2) {
    return (words[0][0] + words[1][0]).toUpperCase();
  }
  return trimmed.slice(0, 2).toUpperCase();
}

export function AccountsListPage({ role }: AccountsListPageProps) {
  const isAdmin = role === "owner" || role === "admin";
  const [accounts, setAccounts] = useState<AccountWithCount[]>([]);
  const [loading, setLoading] = useState(true);
  const [createOpen, setCreateOpen] = useState(false);
  const [editTarget, setEditTarget] = useState<Account | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<Account | null>(null);
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
    fetch("/api/v1/accounts")
      .then((r) => r.json())
      .then(({ data }) => setAccounts(data ?? []))
      .catch(() => toast.error("Failed to load accounts"))
      .finally(() => setLoading(false));
  }, []);

  function handleCreated(account: Account) {
    setAccounts((prev) => [{ ...account, project_count: 0 }, ...prev]);
  }

  function handleUpdated(account: Account) {
    setAccounts((prev) =>
      prev.map((a) =>
        a.id === account.id ? { ...account, project_count: a.project_count } : a
      )
    );
  }

  async function handleDelete(account: Account) {
    setDeleting(true);
    try {
      const res = await fetch(`/api/v1/accounts/${account.id}`, { method: "DELETE" });
      if (!res.ok) throw new Error("Failed to delete account");
      toast.success("Account deleted");
      setAccounts((prev) => prev.filter((a) => a.id !== account.id));
      setDeleteTarget(null);
    } catch {
      toast.error("Failed to delete account");
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
    return accounts.filter((a) => {
      if (filterStatus === "active" && !a.is_active) return false;
      if (filterStatus === "inactive" && a.is_active) return false;
      if (debouncedQ) {
        const q = debouncedQ.toLowerCase();
        const matchesName = a.name.toLowerCase().includes(q);
        const matchesEmail = (a.primary_contact_email ?? "").toLowerCase().includes(q);
        if (!matchesName && !matchesEmail) return false;
      }
      return true;
    });
  }, [accounts, debouncedQ, filterStatus]);

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
        case "projects":
          cmp = a.project_count - b.project_count;
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
  const paginatedAccounts = useMemo(
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
        { value: "active", label: "Active", description: "Active accounts only" },
        { value: "inactive", label: "Inactive", description: "Inactive accounts only" },
        { value: "all", label: "All Statuses", description: "Show every account" },
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
        <h1 className="shrink-0 text-lg font-bold mb-4">Accounts</h1>

        {accounts.length === 0 ? (
          <div className="border rounded-xl p-12 text-center bg-card">
            <Building2 className="h-10 w-10 text-muted-foreground mx-auto mb-4" />
            <h3 className="font-semibold text-lg mb-1">No accounts yet</h3>
            <p className="text-muted-foreground text-sm mb-6">
              Add your first client account to start tracking projects and time.
            </p>
            {isAdmin && (
              <Button onClick={() => setCreateOpen(true)}>
                <Plus className="h-4 w-4 mr-2" />
                Create your first account
              </Button>
            )}
          </div>
        ) : (
          <>
            {/* Toolbar card */}
            <div className="shrink-0">
              {/* Top Row: count + search + spacer + Filters + Sort + New Account */}
              <div className="flex flex-wrap items-center gap-3 p-3">
                <div className="text-sm font-medium text-muted-foreground shrink-0">
                  {sorted.length} Accounts
                </div>

                <div className="relative w-60">
                  <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-3 w-3 text-gray-400" />
                  <input
                    type="text"
                    placeholder="Search by name or email…"
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
                            <SelectItem value="projects">Projects</SelectItem>
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
                    New Account
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
                      <th className="px-2 py-2 text-left text-xs font-medium text-gray-600 w-8"></th>
                      <th className="px-3 py-2 text-left text-xs font-medium text-gray-600">Name</th>
                      <th className="px-3 py-2 text-left text-xs font-medium text-gray-600">Contact Email</th>
                      <th className="px-3 py-2 text-left text-xs font-medium text-gray-600 w-28">Projects</th>
                      <th className="px-3 py-2 text-left text-xs font-medium text-gray-600 w-24">Status</th>
                      {isAdmin && (
                        <th className="px-3 py-2 text-right text-xs font-medium text-gray-600 w-24">Actions</th>
                      )}
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {paginatedAccounts.map((account) => (
                      <tr key={account.id} className="hover:bg-gray-50 transition-colors">
                        <td className="px-2 py-1.5">
                          <div className="h-6 w-6 rounded-full flex items-center justify-center bg-gray-100 border border-gray-300 text-gray-500 text-xs font-medium">
                            {getInitials(account.name)}
                          </div>
                        </td>
                        <td className="px-3 py-1.5">
                          <Link
                            href={`/accounts/${account.id}`}
                            className="text-sm font-medium text-[#0f0f10] hover:underline"
                          >
                            {account.name}
                          </Link>
                        </td>
                        <td className="px-3 py-1.5 text-sm font-normal text-[#787871]">
                          {account.primary_contact_email ? (
                            <a href={`mailto:${account.primary_contact_email}`} className="hover:underline">
                              {account.primary_contact_email}
                            </a>
                          ) : (
                            <span className="text-gray-400">—</span>
                          )}
                        </td>
                        <td className="px-3 py-1.5 text-sm font-normal text-[#787871]">
                          {account.project_count} {account.project_count === 1 ? "project" : "projects"}
                        </td>
                        <td className="px-3 py-1.5">
                          <Badge
                            variant="outline"
                            className={
                              account.is_active
                                ? "bg-green-50 text-green-700 border-green-200"
                                : "bg-gray-100 text-gray-500 border-gray-200"
                            }
                          >
                            {account.is_active ? "Active" : "Inactive"}
                          </Badge>
                        </td>
                        {isAdmin && (
                          <td className="px-3 py-1.5 text-right">
                            <div className="flex items-center justify-end gap-1">
                              <Button
                                variant="ghost"
                                size="sm"
                                className="h-8 w-8 p-0"
                                onClick={(e) => { e.preventDefault(); setEditTarget(account); }}
                              >
                                <Pencil className="h-3.5 w-3.5" />
                              </Button>
                              <Button
                                variant="ghost"
                                size="sm"
                                className="h-8 w-8 p-0 text-muted-foreground hover:text-destructive"
                                onClick={(e) => { e.preventDefault(); setDeleteTarget(account); }}
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
      <AccountForm
        open={createOpen}
        onOpenChange={setCreateOpen}
        onSuccess={handleCreated}
      />

      {/* Edit dialog */}
      {editTarget && (
        <AccountForm
          account={editTarget}
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
            <DialogTitle>Delete Account</DialogTitle>
            <DialogDescription>
              Are you sure you want to delete &quot;{deleteTarget?.name}&quot;? All associated
              projects and tasks will also be deleted. This cannot be undone.
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
