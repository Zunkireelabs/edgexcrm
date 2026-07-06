"use client";

import { useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import {
  Plus,
  ExternalLink,
  Pencil,
  Copy,
  Trash2,
  FileText,
  Loader2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
} from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import type { FormConfig } from "@/types/database";

interface FormListProps {
  forms: FormConfig[];
  tenantSlug: string;
}

export function FormList({ forms: initialForms, tenantSlug }: FormListProps) {
  const [forms, setForms] = useState(initialForms);
  const [loadingId, setLoadingId] = useState<string | null>(null);
  const [deleteDialog, setDeleteDialog] = useState<{ open: boolean; form: FormConfig | null }>({
    open: false,
    form: null,
  });

  async function handleToggleActive(form: FormConfig) {
    setLoadingId(form.id);
    try {
      const res = await fetch(`/api/v1/form-configs/${form.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ is_active: !form.is_active }),
      });
      if (!res.ok) throw new Error("Failed to update");
      setForms((prev) =>
        prev.map((f) => (f.id === form.id ? { ...f, is_active: !f.is_active } : f))
      );
      toast.success(`Form ${!form.is_active ? "activated" : "deactivated"}`);
    } catch {
      toast.error("Failed to update form status");
    } finally {
      setLoadingId(null);
    }
  }

  async function handleDuplicate(form: FormConfig) {
    setLoadingId(`dup-${form.id}`);
    try {
      const res = await fetch(`/api/v1/form-configs/${form.id}/duplicate`, {
        method: "POST",
      });
      if (!res.ok) throw new Error("Failed to duplicate");
      const { data } = await res.json();
      setForms((prev) => [data, ...prev]);
      toast.success("Form duplicated");
    } catch {
      toast.error("Failed to duplicate form");
    } finally {
      setLoadingId(null);
    }
  }

  async function handleDelete(form: FormConfig) {
    setLoadingId(`del-${form.id}`);
    try {
      const res = await fetch(`/api/v1/form-configs/${form.id}`, {
        method: "DELETE",
      });
      if (!res.ok) throw new Error("Failed to delete");
      setForms((prev) => prev.filter((f) => f.id !== form.id));
      toast.success("Form deleted");
    } catch {
      toast.error("Failed to delete form");
    } finally {
      setLoadingId(null);
      setDeleteDialog({ open: false, form: null });
    }
  }

  const publicFormPreviewUrl = (slug: string) =>
    `${window.location.origin}/form/${tenantSlug}/${slug}`;

  return (
    <>
      <div className="flex justify-end">
        <Button asChild>
          <Link href="/forms/new">
            <Plus className="h-4 w-4 mr-2" />
            New Form
          </Link>
        </Button>
      </div>

      {forms.length === 0 ? (
        <div className="border rounded-xl p-12 text-center bg-background">
          <FileText className="h-10 w-10 text-muted-foreground mx-auto mb-4" />
          <h3 className="font-semibold text-lg mb-1">No forms yet</h3>
          <p className="text-muted-foreground text-sm mb-6">
            Create your first form to start collecting leads.
          </p>
          <Button asChild size="lg">
            <Link href="/forms/new">
              <Plus className="h-4 w-4 mr-2" />
              Create Your First Form
            </Link>
          </Button>
        </div>
      ) : (
        <div className="space-y-4">
          {forms.map((form) => {
            const stepCount = Array.isArray(form.steps) ? form.steps.length : 0;
            const fieldCount = Array.isArray(form.steps)
              ? form.steps.reduce(
                  (acc, s) => acc + (Array.isArray(s.fields) ? s.fields.length : 0),
                  0
                )
              : 0;
            const branding = form.branding as { primary_color?: string } | null;
            const accentColor = branding?.primary_color || "#6366f1";

            return (
              <Card key={form.id} className="overflow-hidden border shadow-none hover:shadow-sm transition-shadow">
                <CardContent className="p-0">
                  <div className="flex">
                    {/* Color accent bar */}
                    <div className="w-1.5 shrink-0" style={{ background: accentColor }} />

                    <div className="flex-1 p-5">
                      {/* Top row: name + status */}
                      <div className="flex items-center justify-between mb-1">
                        <h3 className="font-semibold text-base">{form.name}</h3>
                        <button
                          onClick={() => handleToggleActive(form)}
                          disabled={loadingId === form.id}
                          className={`flex items-center gap-1.5 text-xs font-medium px-2.5 py-1 rounded-full transition-colors ${
                            form.is_active
                              ? "bg-green-50 text-green-700 hover:bg-green-100"
                              : "bg-gray-100 text-gray-500 hover:bg-gray-200"
                          }`}
                        >
                          <span className={`w-1.5 h-1.5 rounded-full ${form.is_active ? "bg-green-500" : "bg-gray-400"}`} />
                          {loadingId === form.id ? "..." : form.is_active ? "Active" : "Inactive"}
                        </button>
                      </div>

                      {/* Meta info */}
                      <p className="text-sm text-muted-foreground mb-4">
                        /{tenantSlug}/{form.slug} · {fieldCount} {fieldCount === 1 ? "field" : "fields"}
                        {stepCount > 1 && ` · ${stepCount} steps`}
                      </p>

                      {/* Action buttons */}
                      <div className="flex items-center gap-2 flex-wrap">
                        <Button size="sm" asChild>
                          <Link href={`/forms/${form.id}`}>
                            <Pencil className="h-3.5 w-3.5 mr-1.5" />
                            Edit Form
                          </Link>
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => window.open(publicFormPreviewUrl(form.slug), "_blank")}
                        >
                          <ExternalLink className="h-3.5 w-3.5 mr-1.5" />
                          Preview
                        </Button>
                        <Button
                          variant="outline"
                          size="sm"
                          disabled={loadingId === `dup-${form.id}`}
                          onClick={() => handleDuplicate(form)}
                        >
                          {loadingId === `dup-${form.id}` ? (
                            <Loader2 className="h-3.5 w-3.5 mr-1.5 animate-spin" />
                          ) : (
                            <Copy className="h-3.5 w-3.5 mr-1.5" />
                          )}
                          Duplicate
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="text-muted-foreground hover:text-destructive"
                          onClick={() => setDeleteDialog({ open: true, form })}
                        >
                          <Trash2 className="h-3.5 w-3.5 mr-1.5" />
                          Delete
                        </Button>
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}

      {/* Delete confirmation dialog */}
      <Dialog
        open={deleteDialog.open}
        onOpenChange={(open) => !open && setDeleteDialog({ open: false, form: null })}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete Form</DialogTitle>
            <DialogDescription>
              Are you sure you want to delete &quot;{deleteDialog.form?.name}&quot;? This action
              cannot be undone and will break any existing embed links.
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setDeleteDialog({ open: false, form: null })}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              disabled={loadingId === `del-${deleteDialog.form?.id}`}
              onClick={() => deleteDialog.form && handleDelete(deleteDialog.form)}
            >
              {loadingId === `del-${deleteDialog.form?.id}` ? (
                <Loader2 className="h-4 w-4 animate-spin mr-2" />
              ) : null}
              Delete
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
