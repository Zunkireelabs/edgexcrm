"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import type { Dashboard } from "@/types/database";
import { WIDGET_CATALOG } from "../lib/widget-catalog";

interface SimplePosition {
  id: string;
  name: string;
}

interface DashboardBuilderDialogProps {
  open: boolean;
  onClose: () => void;
  editing?: Dashboard | null;
  onCreated?: (id: string) => void;
}

export function DashboardBuilderDialog({
  open,
  onClose,
  editing,
  onCreated,
}: DashboardBuilderDialogProps) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [selectedWidgets, setSelectedWidgets] = useState<string[]>([]);
  const [selectedPositions, setSelectedPositions] = useState<string[]>([]);
  const [positions, setPositions] = useState<SimplePosition[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) {
      fetch("/api/v1/positions")
        .then((r) => r.json())
        .then((d) => setPositions((d.data ?? []) as SimplePosition[]))
        .catch(() => {});
    }
  }, [open]);

  useEffect(() => {
    if (open) {
      setName(editing?.name ?? "");
      setDescription(editing?.description ?? "");
      setSelectedWidgets(editing?.widgets ?? []);
      setSelectedPositions(editing?.granted_position_ids ?? []);
      setError(null);
    }
  }, [open, editing]);

  function toggleWidget(key: string) {
    setSelectedWidgets((prev) =>
      prev.includes(key) ? prev.filter((k) => k !== key) : [...prev, key]
    );
  }

  function togglePosition(id: string) {
    setSelectedPositions((prev) =>
      prev.includes(id) ? prev.filter((p) => p !== id) : [...prev, id]
    );
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) {
      setError("Name is required.");
      return;
    }
    setSaving(true);
    setError(null);

    const payload = {
      name: name.trim(),
      description: description.trim() || null,
      widgets: selectedWidgets,
      granted_position_ids: selectedPositions,
    };

    const url = editing
      ? `/api/v1/dashboards/${editing.id}`
      : "/api/v1/dashboards";
    const method = editing ? "PATCH" : "POST";

    try {
      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setError(body.message ?? "Failed to save dashboard.");
        return;
      }
      if (!editing && onCreated) {
        const body = await res.json().catch(() => ({}));
        const newId = (body?.data as { id?: string })?.id;
        if (newId) {
          onCreated(newId);
          return;
        }
      }
      router.refresh();
      onClose();
    } catch {
      setError("Network error. Please try again.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{editing ? "Edit Dashboard" : "New Dashboard"}</DialogTitle>
        </DialogHeader>
        <form onSubmit={handleSubmit} className="space-y-5">
          {/* Name */}
          <div className="space-y-1.5">
            <Label htmlFor="dash-name">Name *</Label>
            <Input
              id="dash-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Counsellor Overview"
              required
            />
          </div>

          {/* Description */}
          <div className="space-y-1.5">
            <Label htmlFor="dash-desc">Description</Label>
            <Input
              id="dash-desc"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Optional"
            />
          </div>

          {/* Widgets */}
          <div className="space-y-2">
            <Label>Widgets</Label>
            <div className="space-y-2 border rounded-md p-3">
              {WIDGET_CATALOG.map((w) => (
                <label
                  key={w.key}
                  className="flex items-start gap-3 cursor-pointer"
                >
                  <Checkbox
                    checked={selectedWidgets.includes(w.key)}
                    onCheckedChange={() => toggleWidget(w.key)}
                    className="mt-0.5"
                  />
                  <span>
                    <span className="text-sm font-medium">{w.label}</span>
                    <span className="block text-xs text-gray-500">{w.description}</span>
                  </span>
                </label>
              ))}
            </div>
          </div>

          {/* Positions */}
          <div className="space-y-2">
            <Label>Visible to positions</Label>
            {positions.length === 0 ? (
              <p className="text-sm text-gray-500">No positions configured.</p>
            ) : (
              <div className="space-y-2 border rounded-md p-3">
                {positions.map((pos) => (
                  <label key={pos.id} className="flex items-center gap-3 cursor-pointer">
                    <Checkbox
                      checked={selectedPositions.includes(pos.id)}
                      onCheckedChange={() => togglePosition(pos.id)}
                    />
                    <span className="text-sm">{pos.name}</span>
                  </label>
                ))}
              </div>
            )}
          </div>

          {error && <p className="text-sm text-red-600">{error}</p>}

          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose} disabled={saving}>
              Cancel
            </Button>
            <Button type="submit" disabled={saving}>
              {saving ? "Saving…" : editing ? "Save changes" : "Create"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
