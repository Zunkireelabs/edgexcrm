"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { toast } from "sonner";
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

const NO_ACCOUNT = "__no_account__";

interface AccountRow {
  id: string;
  name: string;
}

interface ConvertLeadDialogProps {
  leadId: string;
  leadFirstName: string | null;
  leadLastName: string | null;
  leadEmail: string | null;
  leadPhone: string | null;
  /** Pre-selected account if lead already has one */
  leadAccountId: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

type AccountMode = "existing" | "new";

export function ConvertLeadDialog({
  leadId,
  leadFirstName,
  leadLastName,
  leadEmail,
  leadPhone,
  leadAccountId,
  open,
  onOpenChange,
}: ConvertLeadDialogProps) {
  const router = useRouter();

  const defaultMode: AccountMode = leadAccountId ? "existing" : "new";
  const [mode, setMode] = useState<AccountMode>(defaultMode);
  const [accounts, setAccounts] = useState<AccountRow[]>([]);
  const [loadingAccounts, setLoadingAccounts] = useState(false);
  const [selectedAccountId, setSelectedAccountId] = useState<string>(leadAccountId ?? NO_ACCOUNT);
  const [newAccountName, setNewAccountName] = useState("");
  const [editFields, setEditFields] = useState(false);
  const [firstName, setFirstName] = useState(leadFirstName ?? "");
  const [lastName, setLastName] = useState(leadLastName ?? "");
  const [email, setEmail] = useState(leadEmail ?? "");
  const [phone, setPhone] = useState(leadPhone ?? "");
  const [title, setTitle] = useState("");
  const [submitting, setSubmitting] = useState(false);

  // Reset state whenever the dialog opens
  useEffect(() => {
    if (!open) return;
    setMode(leadAccountId ? "existing" : "new");
    setSelectedAccountId(leadAccountId ?? NO_ACCOUNT);
    setNewAccountName("");
    setEditFields(false);
    setFirstName(leadFirstName ?? "");
    setLastName(leadLastName ?? "");
    setEmail(leadEmail ?? "");
    setPhone(leadPhone ?? "");
    setTitle("");
  }, [open, leadAccountId, leadFirstName, leadLastName, leadEmail, leadPhone]);

  // Load accounts when switching to "existing" mode
  useEffect(() => {
    if (!open || mode !== "existing") return;
    setLoadingAccounts(true);
    fetch("/api/v1/accounts?pageSize=200")
      .then((r) => r.json())
      .then(({ data }) => setAccounts(data ?? []))
      .catch(() => toast.error("Failed to load accounts"))
      .finally(() => setLoadingAccounts(false));
  }, [open, mode]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();

    if (mode === "existing" && selectedAccountId === NO_ACCOUNT) {
      toast.error("Please select an account");
      return;
    }
    if (mode === "new" && !newAccountName.trim()) {
      toast.error("Please enter an account name");
      return;
    }

    setSubmitting(true);
    try {
      const body: Record<string, unknown> = {};
      if (mode === "existing") {
        body.account_id = selectedAccountId;
      } else {
        body.new_account = { name: newAccountName.trim() };
      }
      if (editFields) {
        if (firstName) body.first_name = firstName;
        if (lastName) body.last_name = lastName;
        if (email) body.email = email;
        if (phone) body.phone = phone;
        if (title) body.title = title;
      }

      const res = await fetch(`/api/v1/leads/${leadId}/convert`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = await res.json();

      if (res.status === 409) {
        toast.error("This lead was just converted by someone else. Refreshing...");
        onOpenChange(false);
        router.refresh();
        return;
      }

      if (!res.ok) {
        toast.error(json.error?.message ?? "Failed to convert lead");
        return;
      }

      toast.success("Lead converted to contact");
      onOpenChange(false);
      router.push(`/contacts/${json.data.contact.id}`);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Convert to Contact</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Account mode selector */}
          <div className="space-y-2">
            <Label>Account</Label>
            <div className="flex gap-4">
              <label className="flex items-center gap-2 cursor-pointer text-sm">
                <input
                  type="radio"
                  name="accountMode"
                  checked={mode === "existing"}
                  onChange={() => setMode("existing")}
                />
                Use existing account
              </label>
              <label className="flex items-center gap-2 cursor-pointer text-sm">
                <input
                  type="radio"
                  name="accountMode"
                  checked={mode === "new"}
                  onChange={() => setMode("new")}
                />
                Create new account
              </label>
            </div>
          </div>

          {mode === "existing" ? (
            <div className="space-y-1.5">
              <Label>Select account</Label>
              {loadingAccounts ? (
                <div className="flex items-center gap-2 text-sm text-muted-foreground py-2">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Loading accounts…
                </div>
              ) : (
                <Select
                  value={selectedAccountId}
                  onValueChange={setSelectedAccountId}
                >
                  <SelectTrigger>
                    <SelectValue placeholder="Pick an account…" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NO_ACCOUNT}>— Pick an account —</SelectItem>
                    {accounts.map((a) => (
                      <SelectItem key={a.id} value={a.id}>
                        {a.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </div>
          ) : (
            <div className="space-y-1.5">
              <Label htmlFor="new-account-name">New account name</Label>
              <Input
                id="new-account-name"
                placeholder="Acme Corp"
                value={newAccountName}
                onChange={(e) => setNewAccountName(e.target.value)}
                autoFocus
              />
            </div>
          )}

          {/* Contact field preview / override */}
          <div className="space-y-2 border rounded-md p-3 bg-muted/40">
            <div className="flex items-center justify-between">
              <p className="text-sm font-medium">Contact fields</p>
              <button
                type="button"
                className="text-xs text-muted-foreground hover:text-foreground underline-offset-4 hover:underline"
                onClick={() => setEditFields((v) => !v)}
              >
                {editFields ? "Use lead values" : "Edit fields"}
              </button>
            </div>
            {editFields ? (
              <div className="space-y-2">
                <div className="grid grid-cols-2 gap-2">
                  <div className="space-y-1">
                    <Label htmlFor="cf-first" className="text-xs">First name</Label>
                    <Input id="cf-first" value={firstName} onChange={(e) => setFirstName(e.target.value)} />
                  </div>
                  <div className="space-y-1">
                    <Label htmlFor="cf-last" className="text-xs">Last name</Label>
                    <Input id="cf-last" value={lastName} onChange={(e) => setLastName(e.target.value)} />
                  </div>
                </div>
                <div className="space-y-1">
                  <Label htmlFor="cf-email" className="text-xs">Email</Label>
                  <Input id="cf-email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="cf-phone" className="text-xs">Phone</Label>
                  <Input id="cf-phone" value={phone} onChange={(e) => setPhone(e.target.value)} />
                </div>
                <div className="space-y-1">
                  <Label htmlFor="cf-title" className="text-xs">Title</Label>
                  <Input id="cf-title" placeholder="e.g. Director of Engineering" value={title} onChange={(e) => setTitle(e.target.value)} />
                </div>
              </div>
            ) : (
              <div className="text-sm text-muted-foreground space-y-0.5">
                <p>{leadFirstName} {leadLastName}</p>
                {leadEmail && <p className="text-xs">{leadEmail}</p>}
                {leadPhone && <p className="text-xs">{leadPhone}</p>}
              </div>
            )}
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={submitting}>
              {submitting && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Convert to Contact
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
