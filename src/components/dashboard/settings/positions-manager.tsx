"use client";

import { useState, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Shield, Lock, Pencil, Trash2, Plus, Users } from "lucide-react";
import { toast } from "sonner";

interface NavItem {
  key: string;
  label: string;
}

interface WidgetItem {
  key: string;
  label: string;
}

interface Pipeline {
  id: string;
  name: string;
}

interface PositionPermissions {
  nav: { mode: "all" } | { mode: "allow"; keys: string[] };
  pipelines: { mode: "all" } | { mode: "allow"; ids: string[] };
  leadScope: "all" | "own" | "team";
  canEditLeads?: boolean;
  canManageApplications?: boolean;
  dashboard: { widgets: { mode: "all" } | { mode: "allow"; keys: string[] } };
}

interface Position {
  id: string;
  name: string;
  slug: string;
  base_tier: "owner" | "admin" | "member";
  is_system: boolean;
  permissions: PositionPermissions;
  member_count: number;
  created_at: string;
}

interface PositionsManagerProps {
  navCatalog: NavItem[];
  widgetCatalog: WidgetItem[];
}

const tierColors: Record<string, string> = {
  owner: "bg-amber-100 text-amber-800",
  admin: "bg-blue-100 text-blue-800",
  member: "bg-gray-100 text-gray-800",
};

function buildDefaultForm(navCatalog: NavItem[], widgetCatalog: WidgetItem[]) {
  return {
    name: "",
    base_tier: "member" as "admin" | "member",
    navMode: "all" as "all" | "allow",
    navKeys: [] as string[],
    pipelinesMode: "all" as "all" | "allow",
    pipelineIds: [] as string[],
    leadScope: "all" as "all" | "own" | "team",
    canEditLeads: false,
    canManageApplications: false,
    widgetsMode: "all" as "all" | "allow",
    widgetKeys: [] as string[],
    _navCatalog: navCatalog,
    _widgetCatalog: widgetCatalog,
  };
}

type FormState = ReturnType<typeof buildDefaultForm>;

function permissionsFromForm(form: FormState): PositionPermissions {
  return {
    nav: form.navMode === "all"
      ? { mode: "all" }
      : { mode: "allow", keys: form.navKeys },
    pipelines: form.pipelinesMode === "all"
      ? { mode: "all" }
      : { mode: "allow", ids: form.pipelineIds },
    leadScope: form.leadScope,
    ...(form.base_tier === "member" ? { canEditLeads: form.leadScope === "own" ? true : form.canEditLeads } : {}),
    ...(form.base_tier === "member" ? { canManageApplications: form.canManageApplications } : {}),
    dashboard: form.widgetsMode === "all"
      ? { widgets: { mode: "all" } }
      : { widgets: { mode: "allow", keys: form.widgetKeys } },
  };
}

function formFromPosition(position: Position, navCatalog: NavItem[], widgetCatalog: WidgetItem[]): FormState {
  const p = position.permissions;
  return {
    name: position.name,
    base_tier: position.base_tier === "admin" ? "admin" : "member",
    navMode: p.nav.mode,
    navKeys: p.nav.mode === "allow" ? p.nav.keys : [],
    pipelinesMode: p.pipelines.mode,
    pipelineIds: p.pipelines.mode === "allow" ? p.pipelines.ids : [],
    leadScope: p.leadScope,
    canEditLeads: p.leadScope === "own" ? true : (p.canEditLeads === true),
    canManageApplications: p.canManageApplications === true,
    widgetsMode: p.dashboard.widgets.mode,
    widgetKeys: p.dashboard.widgets.mode === "allow" ? p.dashboard.widgets.keys : [],
    _navCatalog: navCatalog,
    _widgetCatalog: widgetCatalog,
  };
}

export function PositionsManager({ navCatalog, widgetCatalog }: PositionsManagerProps) {
  const [positions, setPositions] = useState<Position[]>([]);
  const [pipelines, setPipelines] = useState<Pipeline[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingPosition, setEditingPosition] = useState<Position | null>(null);
  const [form, setForm] = useState<FormState>(() => buildDefaultForm(navCatalog, widgetCatalog));
  const [saving, setSaving] = useState(false);

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const [posRes, pipRes] = await Promise.all([
        fetch("/api/v1/positions"),
        fetch("/api/v1/pipelines"),
      ]);
      if (posRes.ok) {
        const json = await posRes.json();
        setPositions(json.data ?? []);
      }
      if (pipRes.ok) {
        const json = await pipRes.json();
        setPipelines(json.data ?? []);
      }
    } catch {
      toast.error("Failed to load positions");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchData();
  }, [fetchData]);

  function openCreate() {
    setEditingPosition(null);
    setForm(buildDefaultForm(navCatalog, widgetCatalog));
    setDialogOpen(true);
  }

  function openEdit(pos: Position) {
    setEditingPosition(pos);
    setForm(formFromPosition(pos, navCatalog, widgetCatalog));
    setDialogOpen(true);
  }

  async function handleSave() {
    if (!form.name.trim()) {
      toast.error("Name is required");
      return;
    }
    setSaving(true);
    try {
      const body: Record<string, unknown> = {
        permissions: permissionsFromForm(form),
      };
      if (!editingPosition || !editingPosition.is_system) {
        body.name = form.name.trim();
        body.base_tier = form.base_tier;
      }

      const url = editingPosition
        ? `/api/v1/positions/${editingPosition.id}`
        : "/api/v1/positions";
      const method = editingPosition ? "PATCH" : "POST";

      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error?.message || "Failed to save position");
      }

      toast.success(editingPosition ? "Position updated" : "Position created");
      setDialogOpen(false);
      fetchData();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to save position");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(pos: Position) {
    if (!confirm(`Delete position "${pos.name}"?`)) return;
    try {
      const res = await fetch(`/api/v1/positions/${pos.id}`, { method: "DELETE" });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.error?.message || "Failed to delete position");
      }
      toast.success("Position deleted");
      fetchData();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to delete");
    }
  }

  function toggleNavKey(key: string) {
    setForm((f) => ({
      ...f,
      navKeys: f.navKeys.includes(key)
        ? f.navKeys.filter((k) => k !== key)
        : [...f.navKeys, key],
    }));
  }

  function togglePipelineId(id: string) {
    setForm((f) => ({
      ...f,
      pipelineIds: f.pipelineIds.includes(id)
        ? f.pipelineIds.filter((k) => k !== id)
        : [...f.pipelineIds, id],
    }));
  }

  function toggleWidgetKey(key: string) {
    setForm((f) => ({
      ...f,
      widgetKeys: f.widgetKeys.includes(key)
        ? f.widgetKeys.filter((k) => k !== key)
        : [...f.widgetKeys, key],
    }));
  }

  if (loading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2">
            <Shield className="h-5 w-5" />
            Positions
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">Loading...</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <>
      <Card>
        <CardHeader className="flex flex-row items-start justify-between">
          <div>
            <CardTitle className="text-lg flex items-center gap-2">
              <Shield className="h-5 w-5" />
              Positions
            </CardTitle>
            <CardDescription>
              Define permission profiles and assign them to team members
            </CardDescription>
          </div>
          <Button size="sm" onClick={openCreate}>
            <Plus className="h-4 w-4 mr-1" />
            New Position
          </Button>
        </CardHeader>
        <CardContent>
          <div className="space-y-3">
            {positions.map((pos) => (
              <div
                key={pos.id}
                className="flex items-center justify-between py-2 border-b last:border-0"
              >
                <div className="flex items-center gap-3">
                  {pos.is_system && <Lock className="h-4 w-4 text-muted-foreground shrink-0" />}
                  <div>
                    <p className="text-sm font-medium flex items-center gap-2">
                      {pos.name}
                    </p>
                    <div className="flex items-center gap-2 mt-0.5">
                      <Badge variant="secondary" className={tierColors[pos.base_tier] || ""}>
                        {pos.base_tier}
                      </Badge>
                      <span className="text-xs text-muted-foreground flex items-center gap-1">
                        <Users className="h-3 w-3" />
                        {pos.member_count}
                      </span>
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-1">
                  <Button
                    variant="ghost"
                    size="icon"
                    className="h-8 w-8"
                    onClick={() => openEdit(pos)}
                  >
                    <Pencil className="h-3.5 w-3.5" />
                  </Button>
                  {!pos.is_system && (
                    <Button
                      variant="ghost"
                      size="icon"
                      className="h-8 w-8 text-muted-foreground hover:text-destructive"
                      onClick={() => handleDelete(pos)}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </Button>
                  )}
                </div>
              </div>
            ))}
            {positions.length === 0 && (
              <p className="text-sm text-muted-foreground text-center py-4">
                No positions yet. Create one to get started.
              </p>
            )}
          </div>
        </CardContent>
      </Card>

      <Dialog open={dialogOpen} onOpenChange={setDialogOpen}>
        <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>
              {editingPosition ? `Edit "${editingPosition.name}"` : "New Position"}
            </DialogTitle>
          </DialogHeader>

          <div className="space-y-5">
            {/* Name */}
            <div className="space-y-1.5">
              <Label>Name</Label>
              <Input
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                placeholder="e.g. Branch Manager"
                disabled={editingPosition?.is_system}
              />
            </div>

            {/* Base tier */}
            <div className="space-y-1.5">
              <Label>Access tier</Label>
              <Select
                value={form.base_tier}
                onValueChange={(v) => setForm((f) => ({ ...f, base_tier: v as "admin" | "member" }))}
                disabled={editingPosition?.is_system}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="admin">Admin — full access, can manage settings</SelectItem>
                  <SelectItem value="member">Member — scoped by the rules below</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* Nav modules */}
            <div className="space-y-2">
              <Label>Nav modules</Label>
              <div className="flex items-center gap-2">
                <Checkbox
                  id="nav-all"
                  checked={form.navMode === "all"}
                  onCheckedChange={(c) =>
                    setForm((f) => ({ ...f, navMode: c ? "all" : "allow" }))
                  }
                />
                <label htmlFor="nav-all" className="text-sm cursor-pointer">
                  All modules
                </label>
              </div>
              {form.navMode === "allow" && (
                <div className="grid grid-cols-2 gap-1.5 pl-6">
                  {navCatalog.map((item) => (
                    <div key={item.key} className="flex items-center gap-2">
                      <Checkbox
                        id={`nav-${item.key}`}
                        checked={form.navKeys.includes(item.key)}
                        onCheckedChange={() => toggleNavKey(item.key)}
                      />
                      <label htmlFor={`nav-${item.key}`} className="text-sm cursor-pointer">
                        {item.label}
                      </label>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Pipelines */}
            <div className="space-y-2">
              <Label>Pipelines</Label>
              <div className="flex items-center gap-2">
                <Checkbox
                  id="pip-all"
                  checked={form.pipelinesMode === "all"}
                  onCheckedChange={(c) =>
                    setForm((f) => ({ ...f, pipelinesMode: c ? "all" : "allow" }))
                  }
                />
                <label htmlFor="pip-all" className="text-sm cursor-pointer">
                  All pipelines
                </label>
              </div>
              {form.pipelinesMode === "allow" && (
                <div className="space-y-1.5 pl-6">
                  {pipelines.map((p) => (
                    <div key={p.id} className="flex items-center gap-2">
                      <Checkbox
                        id={`pip-${p.id}`}
                        checked={form.pipelineIds.includes(p.id)}
                        onCheckedChange={() => togglePipelineId(p.id)}
                      />
                      <label htmlFor={`pip-${p.id}`} className="text-sm cursor-pointer">
                        {p.name}
                      </label>
                    </div>
                  ))}
                  {pipelines.length === 0 && (
                    <p className="text-xs text-muted-foreground">No pipelines found</p>
                  )}
                </div>
              )}
            </div>

            {/* Lead scope (member tier only) */}
            {form.base_tier === "member" && (
              <div className="space-y-1.5">
                <Label>Lead scope</Label>
                <Select
                  value={form.leadScope}
                  onValueChange={(v) => setForm((f) => ({ ...f, leadScope: v as "all" | "own" | "team" }))}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="all">All leads — sees every lead in allowed pipelines</SelectItem>
                    <SelectItem value="own">Only their own assigned leads</SelectItem>
                    <SelectItem value="team">Branch leads — sees assigned leads in their branch</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            )}

            {/* Can edit leads (member+all-scope only) */}
            {form.base_tier === "member" && (
              <div className="space-y-1.5">
                <Label>Lead editing</Label>
                <div className="flex items-center gap-2">
                  <Checkbox
                    id="can-edit"
                    checked={form.leadScope === "own" ? true : form.canEditLeads}
                    disabled={form.leadScope === "own"}
                    onCheckedChange={(c) =>
                      setForm((f) => ({ ...f, canEditLeads: Boolean(c) }))
                    }
                  />
                  <label htmlFor="can-edit" className="text-sm cursor-pointer">
                    Can edit leads
                    {form.leadScope === "own" && (
                      <span className="text-muted-foreground ml-1">
                        (own-scope members always edit their own)
                      </span>
                    )}
                  </label>
                </div>
                {form.base_tier === "member" && (form.leadScope === "all" || form.leadScope === "team") && !form.canEditLeads && (
                  <p className="text-xs text-muted-foreground pl-6">
                    Unchecked → read-only viewer. Checked → branch manager: sees and edits all leads.
                  </p>
                )}
              </div>
            )}

            {/* Can manage applications (member tier only) */}
            {form.base_tier === "member" && (
              <div className="space-y-1.5">
                <Label>Applications</Label>
                <div className="flex items-center gap-2">
                  <Checkbox
                    id="can-manage-applications"
                    checked={form.canManageApplications}
                    onCheckedChange={(c) =>
                      setForm((f) => ({ ...f, canManageApplications: Boolean(c) }))
                    }
                  />
                  <label htmlFor="can-manage-applications" className="text-sm cursor-pointer">
                    Can manage applications
                  </label>
                </div>
                <p className="text-xs text-muted-foreground pl-6">
                  Allows adding, editing, and deleting student applications.
                </p>
              </div>
            )}

            {/* Dashboard widgets */}
            <div className="space-y-2">
              <Label>Dashboard widgets</Label>
              <div className="flex items-center gap-2">
                <Checkbox
                  id="widgets-all"
                  checked={form.widgetsMode === "all"}
                  onCheckedChange={(c) =>
                    setForm((f) => ({ ...f, widgetsMode: c ? "all" : "allow" }))
                  }
                />
                <label htmlFor="widgets-all" className="text-sm cursor-pointer">
                  All widgets
                </label>
              </div>
              {form.widgetsMode === "allow" && (
                <div className="grid grid-cols-2 gap-1.5 pl-6">
                  {widgetCatalog.map((w) => (
                    <div key={w.key} className="flex items-center gap-2">
                      <Checkbox
                        id={`widget-${w.key}`}
                        checked={form.widgetKeys.includes(w.key)}
                        onCheckedChange={() => toggleWidgetKey(w.key)}
                      />
                      <label htmlFor={`widget-${w.key}`} className="text-sm cursor-pointer">
                        {w.label}
                      </label>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          <DialogFooter className="pt-2">
            <Button variant="outline" onClick={() => setDialogOpen(false)}>
              Cancel
            </Button>
            <Button onClick={handleSave} disabled={saving}>
              {saving ? "Saving..." : editingPosition ? "Save changes" : "Create position"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
