"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { Account } from "@/types/database";

interface AccountFormProps {
  account?: Account;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess: (account: Account) => void;
}

export function AccountForm({ account, open, onOpenChange, onSuccess }: AccountFormProps) {
  const isEdit = Boolean(account);
  const [saving, setSaving] = useState(false);
  const [name, setName] = useState(account?.name ?? "");
  const [email, setEmail] = useState(account?.primary_contact_email ?? "");
  const [notes, setNotes] = useState(account?.notes ?? "");

  // Reset form when dialog opens
  function handleOpenChange(next: boolean) {
    if (next) {
      setName(account?.name ?? "");
      setEmail(account?.primary_contact_email ?? "");
      setNotes(account?.notes ?? "");
    }
    onOpenChange(next);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    setSaving(true);
    try {
      const url = isEdit ? `/api/v1/accounts/${account!.id}` : "/api/v1/accounts";
      const method = isEdit ? "PATCH" : "POST";
      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          primary_contact_email: email.trim() || null,
          notes: notes.trim() || null,
        }),
      });
      if (!res.ok) {
        const { error } = await res.json();
        throw new Error(error?.message ?? "Failed to save account");
      }
      const { data } = await res.json();
      toast.success(isEdit ? "Account updated" : "Account created");
      onSuccess(data as Account);
      onOpenChange(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to save account");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{isEdit ? "Edit Account" : "New Account"}</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="space-y-1.5">
            <Label htmlFor="acc-name">Account name *</Label>
            <Input
              id="acc-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="CarbonSpark"
              required
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="acc-email">Primary contact email</Label>
            <Input
              id="acc-email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="contact@example.com"
            />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="acc-notes">Notes</Label>
            <Textarea
              id="acc-notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Optional notes about this account…"
              rows={3}
            />
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={saving || !name.trim()}>
              {saving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              {isEdit ? "Save changes" : "Create account"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
