"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  ArrowLeft,
  Loader2,
  Mail,
  Phone,
  Building2,
  Pencil,
  Trash2,
  FileText,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { ContactStatusBadge } from "../components/contact-status-badge";
import { ContactForm } from "../components/contact-form";
import type { Contact, ContactStatus } from "@/types/database";

interface ContactWithJoins extends Contact {
  accounts: { id: string; name: string } | null;
  project_contacts: Array<{
    role: string | null;
    projects: { id: string; name: string; account_id: string } | null;
  }>;
}

interface ContactDetailPageProps {
  tenantId: string;
  role: "owner" | "admin" | "viewer" | "counselor";
  contactId: string;
}

export function ContactDetailPage({ role, contactId }: ContactDetailPageProps) {
  const router = useRouter();
  const isAdmin = role === "owner" || role === "admin";

  const [contact, setContact] = useState<ContactWithJoins | null>(null);
  const [loading, setLoading] = useState(true);
  const [editOpen, setEditOpen] = useState(false);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [showActions, setShowActions] = useState(false);

  useEffect(() => {
    fetch(`/api/v1/contacts/${contactId}`)
      .then((r) => r.json())
      .then(({ data, error }) => {
        if (error) {
          toast.error("Contact not found");
          router.push("/contacts");
          return;
        }
        setContact(data);
      })
      .catch(() => toast.error("Failed to load contact"))
      .finally(() => setLoading(false));
  }, [contactId, router]);

  function handleUpdated(updated: Contact) {
    setContact((prev) => (prev ? { ...prev, ...updated } : null));
  }

  async function handleDelete() {
    if (!contact) return;
    setDeleting(true);
    try {
      const res = await fetch(`/api/v1/contacts/${contact.id}`, { method: "DELETE" });
      if (!res.ok) throw new Error("Failed to delete contact");
      toast.success("Contact deleted");
      router.push("/contacts");
    } catch {
      toast.error("Failed to delete contact");
    } finally {
      setDeleting(false);
      setDeleteOpen(false);
    }
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-48">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    );
  }

  if (!contact) return null;

  const fullName = `${contact.first_name} ${contact.last_name}`.trim();

  return (
    <div className="p-6 space-y-6 max-w-3xl">
      {/* Back nav */}
      <Button variant="ghost" size="sm" asChild className="-ml-2">
        <Link href="/contacts">
          <ArrowLeft className="h-4 w-4 mr-1.5" />
          Contacts
        </Link>
      </Button>

      {/* Header */}
      <div
        className="flex items-start justify-between gap-4 group"
        onMouseEnter={() => setShowActions(true)}
        onMouseLeave={() => setShowActions(false)}
      >
        <div className="space-y-1">
          <div className="flex items-center gap-3 flex-wrap">
            <h1 className="text-2xl font-semibold">{fullName}</h1>
            <ContactStatusBadge status={contact.status as ContactStatus} />
          </div>
          {contact.title && (
            <p className="text-muted-foreground text-sm">{contact.title}</p>
          )}
        </div>
        {isAdmin && (
          <div
            className={`flex items-center gap-1 shrink-0 transition-opacity ${
              showActions ? "opacity-100" : "opacity-0"
            }`}
          >
            <Button
              variant="ghost"
              size="sm"
              className="h-8 w-8 p-0"
              onClick={() => setEditOpen(true)}
            >
              <Pencil className="h-3.5 w-3.5" />
            </Button>
            <Button
              variant="ghost"
              size="sm"
              className="h-8 w-8 p-0 text-muted-foreground hover:text-destructive"
              onClick={() => setDeleteOpen(true)}
            >
              <Trash2 className="h-3.5 w-3.5" />
            </Button>
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Info card */}
        <div className="lg:col-span-1 space-y-4">
          <Card className="border shadow-none">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-medium text-muted-foreground uppercase tracking-wide">
                Contact Info
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 pt-0">
              {contact.email && (
                <div className="flex items-start gap-2.5">
                  <Mail className="h-4 w-4 text-muted-foreground mt-0.5 shrink-0" />
                  <a
                    href={`mailto:${contact.email}`}
                    className="text-sm hover:underline break-all"
                  >
                    {contact.email}
                  </a>
                </div>
              )}
              {contact.phone && (
                <div className="flex items-start gap-2.5">
                  <Phone className="h-4 w-4 text-muted-foreground mt-0.5 shrink-0" />
                  <a href={`tel:${contact.phone}`} className="text-sm hover:underline">
                    {contact.phone}
                  </a>
                </div>
              )}
              {contact.accounts && (
                <div className="flex items-start gap-2.5">
                  <Building2 className="h-4 w-4 text-muted-foreground mt-0.5 shrink-0" />
                  <Link
                    href={`/accounts/${contact.accounts.id}`}
                    className="text-sm hover:underline"
                  >
                    {contact.accounts.name}
                  </Link>
                </div>
              )}
            </CardContent>
          </Card>

          {/* Notes */}
          {contact.notes && (
            <Card className="border shadow-none">
              <CardHeader className="pb-3">
                <CardTitle className="text-sm font-medium text-muted-foreground uppercase tracking-wide">
                  Notes
                </CardTitle>
              </CardHeader>
              <CardContent className="pt-0">
                <p className="text-sm text-muted-foreground whitespace-pre-wrap">
                  {contact.notes}
                </p>
              </CardContent>
            </Card>
          )}
        </div>

        {/* Projects section */}
        <div className="lg:col-span-2">
          <Card className="border shadow-none">
            <CardHeader className="pb-3">
              <CardTitle className="text-sm font-medium flex items-center gap-2">
                <FileText className="h-4 w-4 text-muted-foreground" />
                Projects
              </CardTitle>
            </CardHeader>
            <CardContent className="pt-0">
              <p className="text-sm text-muted-foreground italic">
                Project linkage coming in Phase C.
              </p>
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Edit dialog */}
      {contact && (
        <ContactForm
          contact={contact}
          open={editOpen}
          onOpenChange={setEditOpen}
          onSuccess={handleUpdated}
        />
      )}

      {/* Delete confirmation */}
      <Dialog open={deleteOpen} onOpenChange={setDeleteOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete Contact</DialogTitle>
            <DialogDescription>
              Are you sure you want to delete &quot;{fullName}&quot;? This cannot be undone.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeleteOpen(false)}>
              Cancel
            </Button>
            <Button variant="destructive" disabled={deleting} onClick={handleDelete}>
              {deleting && <Loader2 className="h-4 w-4 mr-2 animate-spin" />}
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
