"use client";

import { useState, useEffect, useRef } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { Plus, Users, Loader2, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold">Contacts</h1>
          <p className="text-muted-foreground text-sm mt-0.5">
            People at your client accounts
          </p>
        </div>
        {isAdmin && (
          <Button onClick={() => setCreateOpen(true)}>
            <Plus className="h-4 w-4 mr-2" />
            Add Contact
          </Button>
        )}
      </div>

      {/* Filter bar */}
      <div className="flex flex-wrap gap-3">
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 h-4 w-4 text-muted-foreground" />
          <Input
            value={searchInput}
            onChange={(e) => setSearchInput(e.target.value)}
            placeholder="Search by name, email, title…"
            className="pl-8"
          />
        </div>
        <Select value={filterAccountId} onValueChange={setFilterAccountId}>
          <SelectTrigger className="w-[180px]">
            <SelectValue placeholder="All accounts" />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All accounts</SelectItem>
            {accounts.map((a) => (
              <SelectItem key={a.id} value={a.id}>
                {a.name}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <Select value={filterStatus} onValueChange={(v) => setFilterStatus(v as typeof filterStatus)}>
          <SelectTrigger className="w-[140px]">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="active">Active</SelectItem>
            <SelectItem value="inactive">Inactive</SelectItem>
            <SelectItem value="all">All statuses</SelectItem>
          </SelectContent>
        </Select>
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
        <div className="border rounded-xl overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-muted/40 border-b">
              <tr>
                <th className="text-left px-4 py-3 font-medium text-muted-foreground">Name</th>
                <th className="text-left px-4 py-3 font-medium text-muted-foreground">Account</th>
                <th className="text-left px-4 py-3 font-medium text-muted-foreground">Email</th>
                <th className="text-left px-4 py-3 font-medium text-muted-foreground">Title</th>
                <th className="text-left px-4 py-3 font-medium text-muted-foreground">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {contacts.map((contact) => (
                <tr key={contact.id} className="hover:bg-muted/20 transition-colors">
                  <td className="px-4 py-3">
                    <Link
                      href={`/contacts/${contact.id}`}
                      className="font-medium hover:underline"
                    >
                      {fullName(contact)}
                    </Link>
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">
                    {contact.accounts ? (
                      <Link
                        href={`/accounts/${contact.accounts.id}`}
                        className="hover:underline"
                      >
                        {contact.accounts.name}
                      </Link>
                    ) : (
                      "—"
                    )}
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">
                    {contact.email ? (
                      <a href={`mailto:${contact.email}`} className="hover:underline">
                        {contact.email}
                      </a>
                    ) : (
                      "—"
                    )}
                  </td>
                  <td className="px-4 py-3 text-muted-foreground">{contact.title ?? "—"}</td>
                  <td className="px-4 py-3">
                    <ContactStatusBadge status={contact.status as ContactStatus} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <ContactForm open={createOpen} onOpenChange={setCreateOpen} onSuccess={handleCreated} />
    </div>
  );
}
