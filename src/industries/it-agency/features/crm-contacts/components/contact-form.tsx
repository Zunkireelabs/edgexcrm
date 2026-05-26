"use client";

import { useState, useEffect } from "react";
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
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { Account, Contact, ContactStatus } from "@/types/database";

interface ContactFormProps {
  contact?: Contact;
  accountId?: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSuccess: (contact: Contact) => void;
}

export function ContactForm({
  contact,
  accountId,
  open,
  onOpenChange,
  onSuccess,
}: ContactFormProps) {
  const isEdit = Boolean(contact);

  const [saving, setSaving] = useState(false);
  const [firstName, setFirstName] = useState(contact?.first_name ?? "");
  const [lastName, setLastName] = useState(contact?.last_name ?? "");
  const [localAccountId, setLocalAccountId] = useState(contact?.account_id ?? accountId ?? "");
  const [email, setEmail] = useState(contact?.email ?? "");
  const [phone, setPhone] = useState(contact?.phone ?? "");
  const [title, setTitle] = useState(contact?.title ?? "");
  const [status, setStatus] = useState<ContactStatus>(contact?.status ?? "active");
  const [notes, setNotes] = useState(contact?.notes ?? "");
  const [contactInfoError, setContactInfoError] = useState<string | null>(null);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [loadingAccounts, setLoadingAccounts] = useState(false);

  function handleOpenChange(next: boolean) {
    if (next) {
      setFirstName(contact?.first_name ?? "");
      setLastName(contact?.last_name ?? "");
      setLocalAccountId(contact?.account_id ?? accountId ?? "");
      setEmail(contact?.email ?? "");
      setPhone(contact?.phone ?? "");
      setTitle(contact?.title ?? "");
      setStatus(contact?.status ?? "active");
      setNotes(contact?.notes ?? "");
      setContactInfoError(null);
    }
    onOpenChange(next);
  }

  useEffect(() => {
    if (!open) return;
    setLoadingAccounts(true);
    fetch("/api/v1/accounts")
      .then((r) => r.json())
      .then(({ data }) => setAccounts(data ?? []))
      .catch(() => toast.error("Failed to load accounts"))
      .finally(() => setLoadingAccounts(false));
  }, [open]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!firstName.trim() || !lastName.trim()) return;
    if (!email.trim() && !phone.trim()) {
      setContactInfoError("At least one of email or phone is required");
      return;
    }
    setContactInfoError(null);
    setSaving(true);
    try {
      const url = isEdit ? `/api/v1/contacts/${contact!.id}` : "/api/v1/contacts";
      const method = isEdit ? "PATCH" : "POST";
      const body: Record<string, unknown> = {
        first_name: firstName.trim(),
        last_name: lastName.trim(),
        email: email.trim() || null,
        phone: phone.trim() || null,
        title: title.trim() || null,
        status,
        notes: notes.trim() || null,
      };
      if (!isEdit) body.account_id = localAccountId;

      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) {
        const { error } = await res.json();
        throw new Error(error?.message ?? "Failed to save contact");
      }
      const { data } = await res.json();
      toast.success(isEdit ? "Contact updated" : "Contact created");
      onSuccess(data as Contact);
      onOpenChange(false);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to save contact");
    } finally {
      setSaving(false);
    }
  }

  const accountPickerLocked = Boolean(accountId);

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{isEdit ? "Edit Contact" : "New Contact"}</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="contact-fname">First name *</Label>
              <Input
                id="contact-fname"
                value={firstName}
                onChange={(e) => setFirstName(e.target.value)}
                placeholder="Jane"
                required
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="contact-lname">Last name *</Label>
              <Input
                id="contact-lname"
                value={lastName}
                onChange={(e) => setLastName(e.target.value)}
                placeholder="Smith"
                required
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="contact-account">Account *</Label>
            <Select
              value={localAccountId}
              onValueChange={setLocalAccountId}
              disabled={accountPickerLocked || loadingAccounts}
            >
              <SelectTrigger id="contact-account">
                <SelectValue placeholder={loadingAccounts ? "Loading…" : "Select account"} />
              </SelectTrigger>
              <SelectContent>
                {accounts.map((a) => (
                  <SelectItem key={a.id} value={a.id}>
                    {a.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="contact-email">Email</Label>
            <Input
              id="contact-email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="jane@example.com"
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="contact-phone">Phone</Label>
            <Input
              id="contact-phone"
              type="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="+1 555 000 0000"
            />
            {contactInfoError && (
              <p className="text-sm text-destructive">{contactInfoError}</p>
            )}
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="contact-title">Title</Label>
            <Input
              id="contact-title"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="VP of Engineering"
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="contact-status">Status</Label>
            <Select value={status} onValueChange={(v) => setStatus(v as ContactStatus)}>
              <SelectTrigger id="contact-status">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="active">Active</SelectItem>
                <SelectItem value="inactive">Inactive</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="contact-notes">Notes</Label>
            <Textarea
              id="contact-notes"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Optional notes about this contact…"
              rows={3}
            />
          </div>

          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={saving || !firstName.trim() || !lastName.trim() || (!isEdit && !localAccountId)}>
              {saving && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              {isEdit ? "Save changes" : "Create contact"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
