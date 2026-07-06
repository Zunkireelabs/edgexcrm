"use client";

import { useState, useEffect, useCallback } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { CalendarClock, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";

interface LeaveType {
  id: string;
  name: string;
  code: string | null;
  is_paid: boolean;
  requires_approval: boolean;
  annual_allotment_days: number;
  allow_half_day: boolean;
  carry_forward: boolean;
  max_carry_forward_days: number | null;
  is_active: boolean;
}

export function LeaveTypesManager() {
  const [types, setTypes] = useState<LeaveType[]>([]);
  const [loading, setLoading] = useState(true);
  const [createName, setCreateName] = useState("");
  const [createAllotment, setCreateAllotment] = useState("0");
  const [creating, setCreating] = useState(false);
  const [savingId, setSavingId] = useState<string | null>(null);

  const fetchTypes = useCallback(async () => {
    try {
      const res = await fetch("/api/v1/leave/types");
      if (res.ok) {
        const d = await res.json();
        setTypes(d.data ?? []);
      }
    } catch {
      toast.error("Failed to load leave types");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchTypes();
  }, [fetchTypes]);

  async function createType() {
    const name = createName.trim();
    if (!name) return;
    setCreating(true);
    try {
      const res = await fetch("/api/v1/leave/types", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, annual_allotment_days: Number(createAllotment) || 0 }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error?.message ?? "Failed to create leave type");
      setTypes((prev) => [...prev, d.data]);
      setCreateName("");
      setCreateAllotment("0");
      toast.success(`Leave type "${name}" created`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to create leave type");
    } finally {
      setCreating(false);
    }
  }

  async function updateType(id: string, patch: Partial<LeaveType>) {
    setSavingId(id);
    try {
      const res = await fetch(`/api/v1/leave/types/${id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(patch),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error?.message ?? "Failed to update leave type");
      setTypes((prev) => prev.map((t) => (t.id === id ? { ...t, ...(d.data as LeaveType) } : t)));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to update leave type");
    } finally {
      setSavingId(null);
    }
  }

  async function deactivateType(id: string, name: string) {
    if (!confirm(`Deactivate leave type "${name}"? Existing requests keep referencing it.`)) return;
    try {
      const res = await fetch(`/api/v1/leave/types/${id}`, { method: "DELETE" });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error?.message ?? "Failed to deactivate leave type");
      setTypes((prev) => prev.filter((t) => t.id !== id));
      toast.success(`Leave type "${name}" deactivated`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Failed to deactivate leave type");
    }
  }

  if (loading) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-lg flex items-center gap-2">
            <CalendarClock className="h-5 w-5" />
            Leave Types
          </CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm text-muted-foreground">Loading…</p>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-lg flex items-center gap-2">
          <CalendarClock className="h-5 w-5" />
          Leave Types
        </CardTitle>
        <CardDescription>
          Annual allotment, half-day, and carry-forward rules per leave type.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {types.length === 0 ? (
          <p className="text-sm text-muted-foreground">No leave types yet.</p>
        ) : (
          <div className="space-y-1">
            {types.map((t) => (
              <div key={t.id} className="flex items-center gap-3 py-2 border-b last:border-0 flex-wrap">
                <span className="text-sm font-medium w-28 shrink-0">{t.name}</span>

                <div className="flex items-center gap-1.5">
                  <label className="text-xs text-muted-foreground">Allotment/yr</label>
                  <Input
                    type="number"
                    className="h-7 w-20 text-xs"
                    defaultValue={t.annual_allotment_days}
                    onBlur={(e) => {
                      const v = Number(e.target.value);
                      if (v !== t.annual_allotment_days) updateType(t.id, { annual_allotment_days: v });
                    }}
                    disabled={savingId === t.id}
                  />
                </div>

                <label className="flex items-center gap-1.5 text-xs">
                  <Checkbox
                    checked={t.is_paid}
                    onCheckedChange={(v) => updateType(t.id, { is_paid: !!v })}
                  />
                  Paid
                </label>

                <label className="flex items-center gap-1.5 text-xs">
                  <Checkbox
                    checked={t.allow_half_day}
                    onCheckedChange={(v) => updateType(t.id, { allow_half_day: !!v })}
                  />
                  Half-day
                </label>

                <label className="flex items-center gap-1.5 text-xs">
                  <Checkbox
                    checked={t.carry_forward}
                    onCheckedChange={(v) => updateType(t.id, { carry_forward: !!v })}
                  />
                  Carry forward
                </label>

                <Button
                  variant="ghost"
                  size="icon"
                  className="h-7 w-7 ml-auto text-muted-foreground hover:text-destructive"
                  onClick={() => deactivateType(t.id, t.name)}
                  title="Deactivate"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </Button>
              </div>
            ))}
          </div>
        )}

        <div className="flex items-center gap-2 pt-2 border-t">
          <Input
            placeholder="Leave type name (e.g. Maternity)"
            value={createName}
            onChange={(e) => setCreateName(e.target.value)}
            className="flex-1"
          />
          <Input
            type="number"
            placeholder="Days/yr"
            value={createAllotment}
            onChange={(e) => setCreateAllotment(e.target.value)}
            className="w-24"
          />
          <Button onClick={createType} disabled={creating || !createName.trim()} size="sm">
            <Plus className="h-4 w-4 mr-1" />
            {creating ? "Adding…" : "Add"}
          </Button>
        </div>
      </CardContent>
    </Card>
  );
}
