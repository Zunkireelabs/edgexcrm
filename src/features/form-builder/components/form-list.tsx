"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { toast } from "sonner";
import {
  Plus,
  ExternalLink,
  Pencil,
  Copy,
  Trash2,
  ToggleLeft,
  ToggleRight,
  FileText,
  Loader2,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
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
  const router = useRouter();
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

  const publicFormUrl = (slug: string) =>
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
        <div className="border rounded-lg p-12 text-center">
          <FileText className="h-10 w-10 text-muted-foreground mx-auto mb-4" />
          <h3 className="font-medium text-lg mb-1">No forms yet</h3>
          <p className="text-muted-foreground text-sm mb-4">
            Create your first form to start collecting leads.
          </p>
          <Button asChild>
            <Link href="/forms/new">
              <Plus className="h-4 w-4 mr-2" />
              New Form
            </Link>
          </Button>
        </div>
      ) : (
        <div className="space-y-3">
          {forms.map((form) => {
            const stepCount = Array.isArray(form.steps) ? form.steps.length : 0;
            const fieldCount = Array.isArray(form.steps)
              ? form.steps.reduce(
                  (acc, s) => acc + (Array.isArray(s.fields) ? s.fields.length : 0),
                  0
                )
              : 0;

            return (
              <Card key={form.id}>
                <CardHeader className="pb-3">
                  <div className="flex items-start justify-between gap-4">
                    <div className="min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <CardTitle className="text-base">{form.name}</CardTitle>
                        <Badge variant={form.is_active ? "default" : "secondary"}>
                          {form.is_active ? "Active" : "Inactive"}
                        </Badge>
                      </div>
                      <CardDescription className="mt-1 font-mono text-xs">
                        /{tenantSlug}/{form.slug}
                        {" · "}
                        {stepCount} {stepCount === 1 ? "step" : "steps"}
                        {" · "}
                        {fieldCount} {fieldCount === 1 ? "field" : "fields"}
                      </CardDescription>
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      <Button
                        variant="ghost"
                        size="icon"
                        title="View live form"
                        onClick={() => window.open(publicFormUrl(form.slug), "_blank")}
                      >
                        <ExternalLink className="h-4 w-4" />
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        title="Edit form"
                        asChild
                      >
                        <Link href={`/forms/${form.id}`}>
                          <Pencil className="h-4 w-4" />
                        </Link>
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        title="Duplicate form"
                        disabled={loadingId === `dup-${form.id}`}
                        onClick={() => handleDuplicate(form)}
                      >
                        {loadingId === `dup-${form.id}` ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : (
                          <Copy className="h-4 w-4" />
                        )}
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        title={form.is_active ? "Deactivate" : "Activate"}
                        disabled={loadingId === form.id}
                        onClick={() => handleToggleActive(form)}
                      >
                        {loadingId === form.id ? (
                          <Loader2 className="h-4 w-4 animate-spin" />
                        ) : form.is_active ? (
                          <ToggleRight className="h-4 w-4 text-green-500" />
                        ) : (
                          <ToggleLeft className="h-4 w-4" />
                        )}
                      </Button>
                      <Button
                        variant="ghost"
                        size="icon"
                        title="Delete form"
                        disabled={loadingId === `del-${form.id}`}
                        onClick={() => setDeleteDialog({ open: true, form })}
                      >
                        <Trash2 className="h-4 w-4 text-destructive" />
                      </Button>
                    </div>
                  </div>
                </CardHeader>
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
