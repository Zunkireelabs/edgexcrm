"use client";

import { useState, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Textarea } from "@/components/ui/textarea";
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
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { toast } from "sonner";
import { Plus, Pencil, Trash2, GripVertical, Loader2 } from "lucide-react";
import type { TenantEntity, Industry } from "@/types/database";

interface IndustryEntitiesManagerProps {
  industry: Industry;
  initialEntities: TenantEntity[];
}

export function IndustryEntitiesManager({
  industry,
  initialEntities,
}: IndustryEntitiesManagerProps) {
  const [entities, setEntities] = useState<TenantEntity[]>(initialEntities);
  const [createOpen, setCreateOpen] = useState(false);
  const [editEntity, setEditEntity] = useState<TenantEntity | null>(null);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [isActive, setIsActive] = useState(true);
  const [saving, setSaving] = useState(false);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  const refreshEntities = useCallback(async () => {
    try {
      const res = await fetch("/api/v1/entities");
      if (res.ok) {
        const json = await res.json();
        setEntities(json.data || []);
      }
    } catch {
      // Silent — will refresh on next action
    }
  }, []);

  function resetForm() {
    setName("");
    setDescription("");
    setIsActive(true);
    setEditEntity(null);
  }

  function handleOpenCreate() {
    resetForm();
    setCreateOpen(true);
  }

  function handleOpenEdit(entity: TenantEntity) {
    setName(entity.name);
    setDescription(entity.description || "");
    setIsActive(entity.is_active);
    setEditEntity(entity);
    setCreateOpen(true);
  }

  function handleCloseDialog() {
    setCreateOpen(false);
    resetForm();
  }

  async function handleSave() {
    if (!name.trim()) {
      toast.error("Name is required");
      return;
    }

    setSaving(true);
    try {
      const isEdit = !!editEntity;
      const url = isEdit ? `/api/v1/entities/${editEntity.id}` : "/api/v1/entities";
      const method = isEdit ? "PATCH" : "POST";

      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          description: description.trim() || null,
          is_active: isActive,
        }),
      });

      const json = await res.json();

      if (!res.ok) {
        const msg = json.error?.message || `Failed to ${isEdit ? "update" : "create"} ${industry.entity_type_singular.toLowerCase()}`;
        toast.error(msg);
        return;
      }

      toast.success(
        isEdit
          ? `${industry.entity_type_singular} updated`
          : `${industry.entity_type_singular} created`
      );
      handleCloseDialog();
      await refreshEntities();
    } catch {
      toast.error("Network error");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(entity: TenantEntity) {
    if (
      !confirm(
        `Delete "${entity.name}"? This cannot be undone. Leads associated with this ${industry.entity_type_singular.toLowerCase()} will have their association removed.`
      )
    ) {
      return;
    }

    setDeletingId(entity.id);
    try {
      const res = await fetch(`/api/v1/entities/${entity.id}`, {
        method: "DELETE",
      });

      if (res.status === 204) {
        toast.success(`${industry.entity_type_singular} deleted`);
        await refreshEntities();
      } else {
        const json = await res.json();
        toast.error(json.error?.message || "Failed to delete");
      }
    } catch {
      toast.error("Network error");
    } finally {
      setDeletingId(null);
    }
  }

  async function handleToggleActive(entity: TenantEntity) {
    try {
      const res = await fetch(`/api/v1/entities/${entity.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ is_active: !entity.is_active }),
      });

      if (res.ok) {
        toast.success(
          `${industry.entity_type_singular} ${entity.is_active ? "deactivated" : "activated"}`
        );
        await refreshEntities();
      } else {
        const json = await res.json();
        toast.error(json.error?.message || "Failed to update");
      }
    } catch {
      toast.error("Network error");
    }
  }

  const activeCount = entities.filter((e) => e.is_active).length;

  return (
    <Card>
      <CardHeader>
        <div className="flex items-center justify-between">
          <div>
            <CardTitle>Manage {industry.entity_type_label}</CardTitle>
            <CardDescription>
              Add and manage {industry.entity_type_label.toLowerCase()} that appear in your lead forms.
              {entities.length > 0 && (
                <span className="ml-1">
                  {activeCount} active, {entities.length} total
                </span>
              )}
            </CardDescription>
          </div>
          <Dialog open={createOpen} onOpenChange={(open) => {
            if (!open) handleCloseDialog();
            else handleOpenCreate();
          }}>
            <DialogTrigger asChild>
              <Button size="sm">
                <Plus className="h-4 w-4 mr-1" />
                Add {industry.entity_type_singular}
              </Button>
            </DialogTrigger>
            <DialogContent>
              <DialogHeader>
                <DialogTitle>
                  {editEntity ? "Edit" : "Add"} {industry.entity_type_singular}
                </DialogTitle>
                <DialogDescription>
                  {editEntity
                    ? `Update this ${industry.entity_type_singular.toLowerCase()}.`
                    : `Add a new ${industry.entity_type_singular.toLowerCase()} to your list.`}
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-4 py-2">
                <div className="space-y-2">
                  <Label htmlFor="entity-name">Name</Label>
                  <Input
                    id="entity-name"
                    placeholder={`e.g. "${getExampleName(industry.id)}"`}
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    maxLength={255}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="entity-description">Description (optional)</Label>
                  <Textarea
                    id="entity-description"
                    placeholder="Add a brief description..."
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    rows={3}
                  />
                </div>
                <div className="flex items-center gap-3">
                  <Checkbox
                    id="entity-active"
                    checked={isActive}
                    onCheckedChange={(checked) => setIsActive(checked === true)}
                  />
                  <div>
                    <Label htmlFor="entity-active" className="cursor-pointer">Active</Label>
                    <p className="text-xs text-muted-foreground">
                      Inactive items won&apos;t appear in forms
                    </p>
                  </div>
                </div>
              </div>
              <DialogFooter>
                <Button variant="outline" onClick={handleCloseDialog}>
                  Cancel
                </Button>
                <Button onClick={handleSave} disabled={saving || !name.trim()}>
                  {saving ? (
                    <>
                      <Loader2 className="h-4 w-4 mr-1 animate-spin" />
                      Saving...
                    </>
                  ) : editEntity ? (
                    "Save Changes"
                  ) : (
                    `Add ${industry.entity_type_singular}`
                  )}
                </Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
        </div>
      </CardHeader>
      <CardContent>
        {entities.length === 0 ? (
          <div className="text-center py-8 text-muted-foreground">
            <GripVertical className="h-8 w-8 mx-auto mb-3 opacity-50" />
            <p className="text-sm">No {industry.entity_type_label.toLowerCase()} yet</p>
            <p className="text-xs mt-1">
              Add your first {industry.entity_type_singular.toLowerCase()} to get started.
            </p>
          </div>
        ) : (
          <div className="rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Description</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {entities.map((entity) => (
                  <TableRow
                    key={entity.id}
                    className={!entity.is_active ? "opacity-50" : ""}
                  >
                    <TableCell className="font-medium">{entity.name}</TableCell>
                    <TableCell className="text-sm text-muted-foreground max-w-[200px] truncate">
                      {entity.description || "—"}
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant="outline"
                        className={
                          entity.is_active
                            ? "border-green-300 text-green-700 dark:border-green-800 dark:text-green-400"
                            : "text-muted-foreground"
                        }
                      >
                        {entity.is_active ? "Active" : "Inactive"}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="flex items-center justify-end gap-1">
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleToggleActive(entity)}
                        >
                          {entity.is_active ? "Deactivate" : "Activate"}
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => handleOpenEdit(entity)}
                        >
                          <Pencil className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          className="text-destructive hover:text-destructive"
                          disabled={deletingId === entity.id}
                          onClick={() => handleDelete(entity)}
                        >
                          {deletingId === entity.id ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                          ) : (
                            <Trash2 className="h-4 w-4" />
                          )}
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function getExampleName(industryId: string): string {
  const examples: Record<string, string> = {
    education_consultancy: "Harvard University",
    it_agency: "Web Development",
    construction: "Residential Building",
    real_estate: "Apartment",
    healthcare: "Cardiology",
    recruitment: "Software Engineering",
    general: "Premium Service",
  };
  return examples[industryId] || "Example Name";
}
