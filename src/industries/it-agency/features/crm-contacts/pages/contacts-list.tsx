"use client";

import { useState, useEffect, useRef } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { Plus, Users, Loader2, Search, Building2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { FilterDropdown } from "@/components/ui/filter-dropdown";
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
  }

  return (
    <div className="flex flex-1 min-h-0 gap-0">
      <div className="flex flex-col flex-1 min-h-0 min-w-0 gap-2 overflow-hidden pr-6">
        <h1 className="shrink-0 text-lg font-bold mb-4">Contacts</h1>

        {/* Enhanced Toolbar - matching leads style */}
        <div className="shrink-0 bg-card rounded-lg border">
          {/* Top Row: count + search + spacer + Add */}
          <div className="flex flex-wrap items-center gap-3 p-3">
            {/* Contact count */}
            <div className="text-sm font-medium text-muted-foreground shrink-0">
              {contacts.length} Contacts
            </div>

            {/* Search */}
            <div className="relative w-60">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
              <input
                type="text"
                placeholder="Search by name, email, title…"
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                className="w-full h-9 pl-9 pr-3 rounded-md border border-input bg-background text-sm outline-none focus:ring-2 focus:ring-ring"
              />
            </div>

            <div className="flex-1" />

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
              onChange={(val) => setFilterAccountId(val)}
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
              onChange={(val) => setFilterStatus(val as typeof filterStatus)}
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
                    <th className="px-3 py-2 text-left text-xs font-medium text-gray-600">Name</th>
                    <th className="px-3 py-2 text-left text-xs font-medium text-gray-600">Account</th>
                    <th className="px-3 py-2 text-left text-xs font-medium text-gray-600">Email</th>
                    <th className="px-3 py-2 text-left text-xs font-medium text-gray-600">Title</th>
                    <th className="px-3 py-2 text-left text-xs font-medium text-gray-600">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-100">
                  {contacts.map((contact) => (
                    <tr key={contact.id} className="hover:bg-gray-50 transition-colors">
                      <td className="px-3 py-1.5">
                        <Link
                          href={`/contacts/${contact.id}`}
                          className="text-sm font-medium text-[#2272B4] hover:underline"
                        >
                          {fullName(contact)}
                        </Link>
                      </td>
                      <td className="px-3 py-1.5 text-sm text-gray-500 font-light">
                        {contact.accounts ? (
                          <Link href={`/accounts/${contact.accounts.id}`} className="hover:underline">
                            {contact.accounts.name}
                          </Link>
                        ) : (
                          <span className="text-gray-400">—</span>
                        )}
                      </td>
                      <td className="px-3 py-1.5 text-sm text-gray-500 font-light">
                        {contact.email ? (
                          <a href={`mailto:${contact.email}`} className="hover:underline">
                            {contact.email}
                          </a>
                        ) : (
                          <span className="text-gray-400">—</span>
                        )}
                      </td>
                      <td className="px-3 py-1.5 text-sm text-gray-500 font-light">
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
          </div>
        )}
      </div>

      <ContactForm open={createOpen} onOpenChange={setCreateOpen} onSuccess={handleCreated} />
    </div>
  );
}
