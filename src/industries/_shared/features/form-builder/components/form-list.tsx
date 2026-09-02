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
  MoreHorizontal,
  Power,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import type { FormConfig } from "@/types/database";

interface FormListProps {
  forms: FormConfig[];
  tenantSlug: string;
  submissionCounts?: Record<string, { total: number; last30d: number }>;
}

export function FormList({ forms: initialForms, tenantSlug, submissionCounts = {} }: FormListProps) {
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
      {forms.length === 0 ? (
        <div className="border rounded-xl p-12 text-center bg-card">
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
        <div className="border rounded-xl divide-y bg-card overflow-hidden">
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
              <div
                key={form.id}
                className="flex items-center gap-3 px-4 py-3 hover:bg-muted/40 transition-colors"
              >
                <div
                  className="h-8 w-8 shrink-0 rounded-md flex items-center justify-center"
                  style={{ background: `${accentColor}1a` }}
                >
                  <FileText className="h-4 w-4" style={{ color: accentColor }} />
                </div>

                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <h3 className="font-medium text-sm truncate">{form.name}</h3>
                    <span
                      className={`shrink-0 flex items-center gap-1 text-[11px] font-medium px-1.5 py-0.5 rounded-full ${
                        form.is_active
                          ? "bg-green-50 text-green-700"
                          : "bg-gray-100 text-gray-500"
                      }`}
                    >
                      <span className={`w-1.5 h-1.5 rounded-full ${form.is_active ? "bg-green-500" : "bg-gray-400"}`} />
                      {form.is_active ? "Active" : "Inactive"}
                    </span>
                  </div>
                  <p className="text-xs text-muted-foreground truncate">
                    /{tenantSlug}/{form.slug} · {fieldCount} {fieldCount === 1 ? "field" : "fields"}
                    {stepCount > 1 && ` · ${stepCount} steps`}
                    {submissionCounts[form.id] && (
                      <>
                        {" · "}
                        {submissionCounts[form.id].total} submission
                        {submissionCounts[form.id].total === 1 ? "" : "s"}
                        {" "}
                        <span className="text-muted-foreground/70">
                          ({submissionCounts[form.id].last30d} in last 30d)
                        </span>
                      </>
                    )}
                  </p>
                </div>

                <div className="flex items-center gap-1 shrink-0">
                  <Button size="sm" variant="ghost" asChild>
                    <Link href={`/forms/${form.id}`} prefetch={false}>
                      <Pencil className="h-3.5 w-3.5 mr-1.5" />
                      Edit Form
                    </Link>
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => window.open(publicFormPreviewUrl(form.slug), "_blank")}
                  >
                    <ExternalLink className="h-3.5 w-3.5 mr-1.5" />
                    Preview
                  </Button>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button
                        size="icon"
                        variant="ghost"
                        className="h-8 w-8"
                        disabled={loadingId === form.id || loadingId === `dup-${form.id}`}
                      >
                        {loadingId === form.id || loadingId === `dup-${form.id}` ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <MoreHorizontal className="h-4 w-4" />
                        )}
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end">
                      <DropdownMenuItem onClick={() => handleToggleActive(form)}>
                        <Power className="h-3.5 w-3.5 mr-2" />
                        {form.is_active ? "Deactivate" : "Activate"}
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={() => handleDuplicate(form)}>
                        <Copy className="h-3.5 w-3.5 mr-2" />
                        Duplicate
                      </DropdownMenuItem>
                      <DropdownMenuSeparator />
                      <DropdownMenuItem
                        variant="destructive"
                        onClick={() => setDeleteDialog({ open: true, form })}
                      >
                        <Trash2 className="h-3.5 w-3.5 mr-2" />
                        Delete
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              </div>
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
