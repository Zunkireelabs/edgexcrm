"use client";

import { useState, useEffect } from "react";
import { toast } from "sonner";
import { Loader2, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

export type DealContactRole = "primary" | "technical" | "billing" | "other" | "";

interface ContactRow {
  id: string;
  first_name: string;
  last_name: string;
  email: string | null;
  title: string | null;
  status: string;
  account_id: string;
  accounts?: { id: string; name: string } | null;
}

interface PickContactResult {
  role: DealContactRole;
  contacts: { id: string; first_name: string; last_name: string; email: string | null; title: string | null; status: string } | null;
}

interface DealContactPickerProps {
  dealId: string;
  accountId?: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess: (link: PickContactResult) => void;
}

const NO_ROLE = "__none__";

const ROLE_OPTIONS = [
  { value: NO_ROLE, label: "No role" },
  { value: "primary", label: "Primary" },
  { value: "technical", label: "Technical" },
  { value: "billing", label: "Billing" },
  { value: "other", label: "Other" },
];

export function DealContactPicker({ dealId, accountId, open, onOpenChange, onSuccess }: DealContactPickerProps) {
  const [search, setSearch] = useState("");
  const [showAll, setShowAll] = useState(false);
  const [role, setRole] = useState<string>(NO_ROLE);
  const [saving, setSaving] = useState(false);

  const [contacts, setContacts] = useState<ContactRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [selectedContactId, setSelectedContactId] = useState("");

  function resetState() {
    setSearch("");
    setShowAll(false);
    setRole(NO_ROLE);
    setSelectedContactId("");
    setContacts([]);
  }

  function handleOpenChange(next: boolean) {
    if (next) resetState();
    onOpenChange(next);
  }

  useEffect(() => {
    if (!open) return;
    setLoading(true);

    const url = showAll || !accountId
      ? "/api/v1/contacts?include_inactive=1"
      : `/api/v1/contacts?account_id=${accountId}&include_inactive=1`;
    fetch(url)
      .then((r) => r.json())
      .then(({ data }) => setContacts(data ?? []))
      .catch(() => toast.error("Failed to load contacts"))
      .finally(() => setLoading(false));
  }, [open, accountId, showAll]);

  const filteredContacts = contacts.filter((c) => {
    if (!search.trim()) return true;
    const q = search.toLowerCase();
    const fullName = `${c.first_name} ${c.last_name}`.toLowerCase();
    return (
      fullName.includes(q) ||
      (c.email ?? "").toLowerCase().includes(q) ||
      (c.title ?? "").toLowerCase().includes(q) ||
      (c.accounts?.name ?? "").toLowerCase().includes(q)
    );
  });

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!selectedContactId) return;

    setSaving(true);
    try {
      const res = await fetch(`/api/v1/deals/${dealId}/contacts`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contact_id: selectedContactId,
          role: role === NO_ROLE ? undefined : role,
        }),
      });
      const json = await res.json();
      if (!res.ok) {
        const msg = json.error?.message ?? "Failed to link contact";
        toast.error(msg);
        return;
      }
      toast.success("Contact linked");
      onSuccess(json.data as PickContactResult);
      onOpenChange(false);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Add Contact</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Search */}
          <div className="relative">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              className="pl-8"
              placeholder="Search contacts…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>

          {/* Show-all toggle */}
          {accountId && (
            <button
              type="button"
              className="text-xs text-muted-foreground hover:text-foreground underline-offset-4 hover:underline"
              onClick={() => {
                setShowAll((v) => !v);
                setSearch("");
                setSelectedContactId("");
              }}
            >
              {showAll ? "Show only this account's contacts" : "Show all accounts' contacts"}
            </button>
          )}

          {/* List */}
          <div className="border rounded-md max-h-48 overflow-y-auto">
            {loading ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
              </div>
            ) : filteredContacts.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-6">
                No contacts found.
              </p>
            ) : (
              filteredContacts.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => setSelectedContactId(c.id)}
                  className={`w-full text-left px-3 py-2 text-sm hover:bg-muted transition-colors ${
                    selectedContactId === c.id ? "bg-muted font-medium" : ""
                  }`}
                >
                  <span>
                    {c.first_name} {c.last_name}
                  </span>
                  {c.title && (
                    <span className="text-muted-foreground ml-1.5 text-xs">{c.title}</span>
                  )}
                  {c.accounts?.name && (
                    <span className="text-muted-foreground ml-1.5 text-xs">
                      · {c.accounts.name}
                    </span>
                  )}
                </button>
              ))
            )}
          </div>

          {/* Role */}
          <div className="space-y-1.5">
            <Label>Role</Label>
            <Select value={role} onValueChange={(v) => setRole(v as DealContactRole)}>
              <SelectTrigger>
                <SelectValue placeholder="No role" />
              </SelectTrigger>
              <SelectContent>
                {ROLE_OPTIONS.map((opt) => (
                  <SelectItem key={opt.value} value={opt.value}>
                    {opt.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={saving || !selectedContactId}>
              {saving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Add
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
