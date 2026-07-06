"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Pencil, Trash2, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

interface Affiliate {
  id: string;
  name: string;
  ref_code: string;
  email: string | null;
  status: "active" | "inactive";
  created_at: string;
  updated_at: string;
}

interface FormState {
  name: string;
  ref_code: string;
  email: string;
  status: "active" | "inactive";
}

const EMPTY_FORM: FormState = { name: "", ref_code: "", email: "", status: "active" };

export function AffiliatesPage() {
  const [affiliates, setAffiliates] = useState<Affiliate[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<Affiliate | null>(null);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  async function load() {
    try {
      const res = await fetch("/api/v1/affiliates");
      const json = await res.json();
      if (json.error) throw new Error(json.error.message);
      setAffiliates(json.data ?? []);
    } catch (e) {
      toast.error("Failed to load affiliates");
      console.error(e);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  function openAdd() {
    setEditing(null);
    setForm(EMPTY_FORM);
    setDialogOpen(true);
  }

  function openEdit(a: Affiliate) {
    setEditing(a);
    setForm({ name: a.name, ref_code: a.ref_code, email: a.email ?? "", status: a.status });
    setDialogOpen(true);
  }

  async function handleSave() {
    const name = form.name.trim();
    const ref_code = form.ref_code.trim().toUpperCase();
    const email = form.email.trim() || null;

    if (!name) { toast.error("Name is required"); return; }
    if (!editing && !ref_code) { toast.error("Ref code is required"); return; }
    if (!editing && /\s/.test(ref_code)) { toast.error("Ref code must not contain spaces"); return; }

    setSaving(true);
    try {
      if (editing) {
        const res = await fetch(`/api/v1/affiliates/${editing.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name, email, status: form.status }),
        });
        const json = await res.json();
        if (!res.ok) throw new Error(json.error?.message ?? "Failed to update");
        toast.success("Affiliate updated");
      } else {
        const res = await fetch("/api/v1/affiliates", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ name, ref_code, email }),
        });
        const json = await res.json();
        if (!res.ok) throw new Error(json.error?.message ?? "Failed to create");
        toast.success("Affiliate added");
      }
      setDialogOpen(false);
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(id: string) {
    setDeleting(true);
    try {
      const res = await fetch(`/api/v1/affiliates/${id}`, { method: "DELETE" });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error?.message ?? "Failed to delete");
      toast.success("Affiliate deleted");
      setConfirmDeleteId(null);
      await load();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setDeleting(false);
    }
  }

  return (
    <>
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold">Affiliates</h1>
          <p className="text-sm text-muted-foreground mt-1">
            Track affiliate referrals by ref code.
          </p>
        </div>
        <Button onClick={openAdd} size="sm">Add Affiliate</Button>
      </div>

      {/* Content */}
      {loading ? (
        <div className="flex items-center justify-center h-48 text-muted-foreground text-sm">
          Loading affiliates…
        </div>
      ) : affiliates.length === 0 ? (
        <div className="flex flex-col items-center justify-center h-48 gap-2 text-muted-foreground">
          <Users className="h-8 w-8 opacity-40" />
          <p className="text-sm">No affiliates yet. Add your first affiliate to start tracking referrals.</p>
        </div>
      ) : (
        <div className="rounded-lg border overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b bg-muted/40">
                <th className="px-4 py-3 text-left font-medium text-muted-foreground">Name</th>
                <th className="px-4 py-3 text-left font-medium text-muted-foreground">Ref Code</th>
                <th className="px-4 py-3 text-left font-medium text-muted-foreground hidden sm:table-cell">Email</th>
                <th className="px-4 py-3 text-left font-medium text-muted-foreground">Status</th>
                <th className="px-4 py-3 text-right font-medium text-muted-foreground">Actions</th>
              </tr>
            </thead>
            <tbody>
              {affiliates.map((a) => (
                <tr key={a.id} className="border-b last:border-0 hover:bg-muted/20 transition-colors">
                  <td className="px-4 py-3 font-medium">{a.name}</td>
                  <td className="px-4 py-3">
                    <code className="bg-muted px-1.5 py-0.5 rounded text-xs font-mono">{a.ref_code}</code>
                  </td>
                  <td className="px-4 py-3 text-muted-foreground hidden sm:table-cell">
                    {a.email ?? "—"}
                  </td>
                  <td className="px-4 py-3">
                    {a.status === "active" ? (
                      <Badge className="bg-green-100 text-green-800 hover:bg-green-100 border-0 text-xs">Active</Badge>
                    ) : (
                      <Badge variant="secondary" className="text-xs">Inactive</Badge>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center justify-end gap-1">
                      {confirmDeleteId === a.id ? (
                        <div className="flex items-center gap-2">
                          <span className="text-xs text-muted-foreground">Confirm?</span>
                          <Button
                            size="sm"
                            variant="destructive"
                            className="h-7 px-2 text-xs"
                            onClick={() => handleDelete(a.id)}
                            disabled={deleting}
                          >
                            Yes
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            className="h-7 px-2 text-xs"
                            onClick={() => setConfirmDeleteId(null)}
                            disabled={deleting}
                          >
                            No
                          </Button>
                        </div>
                      ) : (
                        <>
                          <Button
                            size="icon"
                            variant="ghost"
                            className="h-8 w-8"
                            onClick={() => openEdit(a)}
                          >
                            <Pencil className="h-3.5 w-3.5" />
                          </Button>
                          <Button
                            size="icon"
                            variant="ghost"
                            className="h-8 w-8 text-destructive hover:text-destructive"
                            onClick={() => setConfirmDeleteId(a.id)}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Add / Edit Dialog */}
      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>{editing ? "Edit Affiliate" : "Add Affiliate"}</DialogTitle>
          </DialogHeader>

          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <label className="text-sm font-medium">Name <span className="text-destructive">*</span></label>
              <Input
                placeholder="e.g. John Doe"
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              />
            </div>

            <div className="space-y-1.5">
              <label className="text-sm font-medium">
                Ref Code <span className="text-destructive">*</span>
              </label>
              <Input
                placeholder="e.g. JOHNDOE2026"
                value={form.ref_code}
                disabled={!!editing}
                onChange={(e) => setForm((f) => ({ ...f, ref_code: e.target.value.toUpperCase() }))}
                className={editing ? "opacity-60 cursor-not-allowed" : ""}
              />
              <p className="text-xs text-muted-foreground">
                {editing
                  ? "Ref code cannot be changed after creation."
                  : "Uppercase letters and numbers only, no spaces."}
              </p>
            </div>

            <div className="space-y-1.5">
              <label className="text-sm font-medium">Email <span className="text-muted-foreground text-xs">(optional)</span></label>
              <Input
                type="email"
                placeholder="affiliate@example.com"
                value={form.email}
                onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))}
              />
            </div>

            {editing && (
              <div className="space-y-1.5">
                <label className="text-sm font-medium">Status</label>
                <Select
                  value={form.status}
                  onValueChange={(v) => setForm((f) => ({ ...f, status: v as "active" | "inactive" }))}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="active">Active</SelectItem>
                    <SelectItem value="inactive">Inactive</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            )}
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setDialogOpen(false)} disabled={saving}>
              Cancel
            </Button>
            <Button onClick={handleSave} disabled={saving}>
              {saving ? "Saving…" : editing ? "Save Changes" : "Add Affiliate"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
