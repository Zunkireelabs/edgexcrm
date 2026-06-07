"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import type { Lead } from "@/types/database";

interface MergeDialogProps {
  leadA: Lead;
  leadB: Lead;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onMerged?: () => void;
}

// Fields displayed in the side-by-side diff
const DIFF_FIELDS: { key: keyof Lead; label: string }[] = [
  { key: "first_name", label: "First name" },
  { key: "last_name", label: "Last name" },
  { key: "email", label: "Email" },
  { key: "phone", label: "Phone" },
  { key: "city", label: "City" },
  { key: "country", label: "Country" },
];

function formatFieldValue(lead: Lead, key: keyof Lead): string {
  const val = lead[key];
  if (val === null || val === undefined || val === "") return "—";
  if (key === "tags" && Array.isArray(val)) return (val as string[]).join(", ") || "—";
  if (key === "custom_fields" && typeof val === "object") {
    const entries = Object.entries(val as Record<string, unknown>);
    return entries.length ? entries.map(([k, v]) => `${k}: ${v}`).join(", ") : "—";
  }
  return String(val);
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
}

export function MergeDialog({ leadA, leadB, open, onOpenChange, onMerged }: MergeDialogProps) {
  // Default canonical = older lead (lower created_at)
  const olderFirst = new Date(leadA.created_at) <= new Date(leadB.created_at);
  const [canonicalId, setCanonicalId] = useState<string>(olderFirst ? leadA.id : leadB.id);
  const [merging, setMerging] = useState(false);
  const router = useRouter();

  const canonical = canonicalId === leadA.id ? leadA : leadB;
  const absorbed = canonicalId === leadA.id ? leadB : leadA;

  async function handleMerge() {
    setMerging(true);
    try {
      const res = await fetch("/api/v1/leads/merge", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ canonical_id: canonicalId, absorbed_id: absorbed.id }),
      });
      const json = await res.json();
      if (!res.ok) {
        const msg = json?.error?.details?.merge?.[0] ?? json?.error?.message ?? "Merge failed";
        toast.error(msg);
        return;
      }
      toast.success("Leads merged successfully");
      onOpenChange(false);
      onMerged?.();
      router.refresh();
    } catch {
      toast.error("Merge failed — please try again");
    } finally {
      setMerging(false);
    }
  }

  const leadLabel = (lead: Lead) => {
    const name = `${lead.first_name ?? ""} ${lead.last_name ?? ""}`.trim() || lead.email || lead.id.slice(0, 8);
    return `${name} (created ${formatDate(lead.created_at)})`;
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>Merge duplicate leads</DialogTitle>
          <DialogDescription>
            Choose which record to keep. The other record&apos;s notes, activities, tasks,
            emails, and submissions will move to the kept lead. The absorbed lead is archived
            and can be restored by an admin.
          </DialogDescription>
        </DialogHeader>

        {/* Canonical selector */}
        <div className="space-y-2">
          <p className="text-sm font-medium">Keep as the primary record:</p>
          <div className="grid grid-cols-2 gap-3">
            {[leadA, leadB].map((lead) => (
              <label
                key={lead.id}
                className={`flex items-start gap-3 rounded-lg border p-3 cursor-pointer transition-colors ${
                  canonicalId === lead.id
                    ? "border-primary bg-primary/5"
                    : "border-border hover:border-muted-foreground/40"
                }`}
              >
                <input
                  type="radio"
                  name="canonical"
                  value={lead.id}
                  checked={canonicalId === lead.id}
                  onChange={() => setCanonicalId(lead.id)}
                  className="mt-0.5 accent-primary"
                />
                <div className="min-w-0">
                  <p className="text-sm font-medium truncate">
                    {`${lead.first_name ?? ""} ${lead.last_name ?? ""}`.trim() || "—"}
                  </p>
                  <p className="text-xs text-muted-foreground truncate">{lead.email ?? "—"}</p>
                  <p className="text-xs text-muted-foreground">{formatDate(lead.created_at)}</p>
                </div>
              </label>
            ))}
          </div>
        </div>

        {/* Side-by-side field diff */}
        <div className="rounded-lg border overflow-hidden">
          <div className="grid grid-cols-[120px_1fr_1fr] bg-muted/50 border-b text-xs font-medium">
            <div className="px-3 py-2 text-muted-foreground">Field</div>
            <div className="px-3 py-2 border-l">
              <span className={canonicalId === leadA.id ? "text-primary font-semibold" : "text-muted-foreground"}>
                {canonicalId === leadA.id ? "✓ Keep" : "Archive"}
              </span>
            </div>
            <div className="px-3 py-2 border-l">
              <span className={canonicalId === leadB.id ? "text-primary font-semibold" : "text-muted-foreground"}>
                {canonicalId === leadB.id ? "✓ Keep" : "Archive"}
              </span>
            </div>
          </div>
          {DIFF_FIELDS.map((field) => {
            const valA = formatFieldValue(leadA, field.key);
            const valB = formatFieldValue(leadB, field.key);
            const differs = valA !== valB;
            return (
              <div
                key={field.key}
                className={`grid grid-cols-[120px_1fr_1fr] text-sm border-b last:border-b-0 ${
                  differs ? "bg-amber-50/50" : ""
                }`}
              >
                <div className="px-3 py-2 text-muted-foreground text-xs font-medium">{field.label}</div>
                <div className={`px-3 py-2 border-l truncate ${canonicalId === leadA.id && differs ? "font-medium" : ""}`}>
                  {valA}
                </div>
                <div className={`px-3 py-2 border-l truncate ${canonicalId === leadB.id && differs ? "font-medium" : ""}`}>
                  {valB}
                </div>
              </div>
            );
          })}
        </div>

        <p className="text-xs text-muted-foreground">
          <strong>Kept:</strong> {leadLabel(canonical)} &nbsp;·&nbsp;
          <strong>Archived:</strong> {leadLabel(absorbed)}
        </p>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={merging}>
            Cancel
          </Button>
          <Button onClick={handleMerge} disabled={merging}>
            {merging ? "Merging…" : "Merge leads"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
