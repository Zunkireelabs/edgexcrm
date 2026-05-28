"use client";

import { useState, useEffect, useRef, useMemo } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { Plus, Users, Loader2, Search, Building2, X, ArrowUpDown, ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { FilterDropdown } from "@/components/ui/filter-dropdown";
import { Popover, PopoverTrigger, PopoverContent } from "@/components/ui/popover";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ContactStatusBadge } from "../components/contact-status-badge";
import { ContactForm } from "../components/contact-form";
import type { Account, Contact, ContactStatus } from "@/types/database";

interface ContactWithAccount extends Contact {
  accounts: { id: string; name: string } | null;
}

interface ContactsListPageProps {
  tenantId: string;
  role: "owner" | "admin" | "viewer" | "counselor";
}

type SortField = "name" | "email" | "title" | "created";
type SortDirection = "asc" | "desc";

function getInitials(firstName?: string | null, lastName?: string | null): string {
  const first = firstName?.charAt(0)?.toUpperCase() || "";
  const last = lastName?.charAt(0)?.toUpperCase() || "";
  return first + last || "?";
}

export function ContactsListPage({ role }: ContactsListPageProps) {
  const isAdmin = role === "owner" || role === "admin";
  const [contacts, setContacts] = useState<ContactWithAccount[]>([]);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [loading, setLoading] = useState(true);
  const [createOpen, setCreateOpen] = useState(false);

  const [searchInput, setSearchInput] = useState("");
  const [debouncedQ, setDebouncedQ] = useState("");
  const [filterAccountId, setFilterAccountId] = useState("all");
  const [filterStatus, setFilterStatus] = useState<"active" | "inactive" | "all">("active");

  // Sort state
  const [sortField, setSortField] = useState<SortField>("name");
  const [sortDirection, setSortDirection] = useState<SortDirection>("asc");

  // Pagination state
  const [currentPage, setCurrentPage] = useState(1);
  const [itemsPerPage, setItemsPerPage] = useState(25);

  const debounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Debounce search input
  useEffect(() => {
    if (debounceTimer.current) clearTimeout(debounceTimer.current);
    debounceTimer.current = setTimeout(() => setDebouncedQ(searchInput), 250);
    return () => {
      if (debounceTimer.current) clearTimeout(debounceTimer.current);
    };
  }, [searchInput]);

  // Load accounts for filter dropdown
  useEffect(() => {
    fetch("/api/v1/accounts")
      .then((r) => r.json())
      .then(({ data }) => setAccounts(data ?? []))
      .catch(() => {});
  }, []);

  // Fetch contacts whenever filters change
  // setLoading(false) only — initial state is already true, and filter updates
  // replace data in-place without re-showing the full-page spinner.
  useEffect(() => {
    const params = new URLSearchParams();
    if (filterAccountId !== "all") params.set("account_id", filterAccountId);
    if (filterStatus === "all") params.set("include_inactive", "1");
    else params.set("status", filterStatus);
    if (debouncedQ) params.set("q", debouncedQ);

    fetch(`/api/v1/contacts?${params.toString()}`)
      .then((r) => r.json())
      .then(({ data }) => setContacts(data ?? []))
      .catch(() => toast.error("Failed to load contacts"))
      .finally(() => setLoading(false));
  }, [filterAccountId, filterStatus, debouncedQ]);

  function handleCreated(contact: Contact) {
    setContacts((prev) => [contact as ContactWithAccount, ...prev]);
  }

  const fullName = (c: Contact) => `${c.first_name} ${c.last_name}`.trim();

  const activeFiltersCount = [
    searchInput !== "",
    filterAccountId !== "all",
    filterStatus !== "active",
  ].filter(Boolean).length;
  const hasActiveFilters = activeFiltersCount > 0;

  function clearFilters() {
    setSearchInput("");
    setFilterAccountId("all");
    setFilterStatus("active");
    setCurrentPage(1);
  }

  // Client-side sort
  const sorted = useMemo(() => {
    const result = [...contacts];
    result.sort((a, b) => {
      let cmp = 0;
      switch (sortField) {
        case "name": {
          const aName = `${a.first_name || ""} ${a.last_name || ""}`.trim().toLowerCase();
          const bName = `${b.first_name || ""} ${b.last_name || ""}`.trim().toLowerCase();
          cmp = aName.localeCompare(bName);
          break;
        }
        case "email":
          cmp = (a.email || "").toLowerCase().localeCompare((b.email || "").toLowerCase());
          break;
        case "title":
          cmp = (a.title || "").toLowerCase().localeCompare((b.title || "").toLowerCase());
          break;
        case "created":
          cmp = new Date(a.created_at).getTime() - new Date(b.created_at).getTime();
          break;
      }
      return sortDirection === "asc" ? cmp : -cmp;
    });
    return result;
  }, [contacts, sortField, sortDirection]);

  // Pagination calculations — clamp page to valid range without an effect
  const totalPages = Math.ceil(sorted.length / itemsPerPage);
  const safePage = totalPages > 0 ? Math.min(currentPage, totalPages) : 1;
  const startIndex = (safePage - 1) * itemsPerPage;
  const endIndex = Math.min(startIndex + itemsPerPage, sorted.length);
  const paginatedContacts = useMemo(() => {
    return sorted.slice(startIndex, endIndex);
  }, [sorted, startIndex, endIndex]);

  return (
    <div className="flex flex-1 min-h-0 gap-0">
      <div className="flex flex-col flex-1 min-h-0 min-w-0 gap-2 overflow-hidden pr-6">
        <h1 className="shrink-0 text-lg font-bold mb-4">Contacts</h1>

        {/* Enhanced Toolbar - matching leads style */}
        <div className="shrink-0 bg-card rounded-lg border">
          {/* Top Row: count + search + spacer + Sort + Add */}
          <div className="flex flex-wrap items-center gap-3 p-3">
            {/* Contact count */}
            <div className="text-sm font-medium text-muted-foreground shrink-0">
              {sorted.length} Contacts
            </div>

            {/* Search */}
            <div className="relative w-60">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <input
                type="text"
                placeholder="Search by name, email, title…"
                value={searchInput}
                onChange={(e) => { setSearchInput(e.target.value); setCurrentPage(1); }}
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
                    <Select value={sortField} onValueChange={(v) => { setSortField(v as SortField); setCurrentPage(1); }}>
                      <SelectTrigger className="flex-1 h-9">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="name">Name</SelectItem>
                        <SelectItem value="email">Email</SelectItem>
                        <SelectItem value="title">Title</SelectItem>
                        <SelectItem value="created">Date created</SelectItem>
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

            {/* Add Contact */}
            {isAdmin && (
              <Button size="sm" className="h-9 gap-2" onClick={() => setCreateOpen(true)}>
                <Plus className="h-4 w-4" />
                Add Contact
              </Button>
            )}
          </div>

          {/* Divider */}
          <div className="h-px bg-border" />

          {/* Filter Row */}
          <div className="flex flex-wrap items-center gap-1.5 px-3 py-2">
            <FilterDropdown
              label="All Accounts"
              value={filterAccountId}
              onChange={(val) => { setFilterAccountId(val); setCurrentPage(1); }}
              icon={<Building2 className="h-3 w-3" />}
              options={[
                { value: "all", label: "All Accounts", description: "Show contacts at every account" },
                ...accounts.map((a) => ({
                  value: a.id,
                  label: a.name,
                  description: `Contacts at ${a.name}`,
                })),
              ]}
            />

            <FilterDropdown
              label="All Statuses"
              value={filterStatus}
              onChange={(val) => { setFilterStatus(val as typeof filterStatus); setCurrentPage(1); }}
              searchable={false}
              options={[
                { value: "active", label: "Active", description: "Active contacts only" },
                { value: "inactive", label: "Inactive", description: "Inactive contacts only" },
                { value: "all", label: "All Statuses", description: "Show every contact" },
              ]}
            />

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

        {/* Content */}
        {loading ? (
          <div className="flex items-center justify-center h-48">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
          </div>
        ) : contacts.length === 0 ? (
          <div className="border rounded-xl p-12 text-center bg-background">
            <Users className="h-10 w-10 text-muted-foreground mx-auto mb-4" />
            <h3 className="font-semibold text-lg mb-1">No contacts found</h3>
            <p className="text-muted-foreground text-sm mb-6">
              {debouncedQ || filterAccountId !== "all"
                ? "Try adjusting your filters."
                : "Add your first contact to start tracking people at your accounts."}
            </p>
            {isAdmin && !debouncedQ && filterAccountId === "all" && (
              <Button onClick={() => setCreateOpen(true)}>
                <Plus className="h-4 w-4 mr-2" />
                Add your first contact
              </Button>
            )}
          </div>
        ) : (
          <div className="flex-1 min-h-0 bg-white rounded-lg border border-gray-200 flex flex-col overflow-hidden">
            <div className="flex-1 min-h-0 overflow-auto">
              <table className="w-full">
                <thead className="sticky top-0 z-10">
                  <tr className="border-b border-gray-200 bg-gray-50">
                    <th className="px-2 py-2 text-left text-xs font-medium text-gray-600 w-8"></th>
                    <th className="px-3 py-2 text-left text-xs font-medium text-gray-600">Name</th>
                    <th className="px-3 py-2 text-left text-xs font-medium text-gray-600">Account</th>
                    <th className="px-3 py-2 text-left text-xs font-medium text-gray-600">Email</th>
                    <th className="px-3 py-2 text-left text-xs font-medium text-gray-600">Title</th>
                    <th className="px-3 py-2 text-left text-xs font-medium text-gray-600">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {paginatedContacts.map((contact) => (
                    <tr key={contact.id} className="hover:bg-gray-50 transition-colors">
                      <td className="px-2 py-1.5">
                        <div className="h-6 w-6 rounded-full flex items-center justify-center bg-gray-100 border border-gray-300 text-gray-500 text-xs font-medium">
                          {getInitials(contact.first_name, contact.last_name)}
                        </div>
                      </td>
                      <td className="px-3 py-1.5">
                        <Link
                          href={`/contacts/${contact.id}`}
                          className="text-sm font-medium text-[#2272B4] hover:underline"
                        >
                          {fullName(contact)}
                        </Link>
                      </td>
                      <td className="px-3 py-1.5 text-sm text-gray-700 font-normal">
                        {contact.accounts ? (
                          <Link href={`/accounts/${contact.accounts.id}`} className="hover:underline">
                            {contact.accounts.name}
                          </Link>
                        ) : (
                          <span className="text-gray-400">—</span>
                        )}
                      </td>
                      <td className="px-3 py-1.5 text-sm text-gray-700 font-normal">
                        {contact.email ? (
                          <a href={`mailto:${contact.email}`} className="hover:underline">
                            {contact.email}
                          </a>
                        ) : (
                          <span className="text-gray-400">—</span>
                        )}
                      </td>
                      <td className="px-3 py-1.5 text-sm text-gray-700 font-normal">
                        {contact.title ?? <span className="text-gray-400">—</span>}
                      </td>
                      <td className="px-3 py-1.5">
                        <ContactStatusBadge status={contact.status as ContactStatus} />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Pagination footer — inside table card, below scroll region */}
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
        )}
      </div>

      <ContactForm open={createOpen} onOpenChange={setCreateOpen} onSuccess={handleCreated} />
    </div>
  );
}
