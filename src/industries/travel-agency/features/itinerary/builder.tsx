"use client";

import { useState } from "react";
import { Plus, Trash2, ChevronUp, ChevronDown, Printer } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { formatMoney } from "@/lib/travel/currency";
import {
  type Itinerary,
  type ItineraryDay,
  type ItineraryLineItem,
  LINE_ITEM_CATEGORIES,
  emptyItinerary,
  lineItemTotal,
  grandTotal,
} from "./types";
import { ItineraryProposal } from "./proposal";
import type { Lead } from "@/types/database";

interface ItineraryBuilderProps {
  lead: Lead;
  tenantName: string;
  tenantLogoUrl?: string | null;
  onSave: (itinerary: Itinerary) => Promise<void>;
}

function uid() {
  return Math.random().toString(36).slice(2, 9);
}

function parseStoredItinerary(lead: Lead): Itinerary | null {
  const cf = (lead.custom_fields || {}) as Record<string, unknown>;
  if (!cf.itinerary) return null;
  try {
    const raw = typeof cf.itinerary === "string" ? JSON.parse(cf.itinerary) : cf.itinerary;
    return raw as Itinerary;
  } catch {
    return null;
  }
}

function computeNights(lead: Lead): number | null {
  const cf = (lead.custom_fields || {}) as Record<string, unknown>;
  const s = cf.trip_start_date;
  const e = cf.trip_end_date;
  if (!s || !e) return null;
  const diff = new Date(String(e)).getTime() - new Date(String(s)).getTime();
  const nights = Math.round(diff / 86_400_000);
  return nights > 0 ? nights : null;
}

export function ItineraryBuilder({ lead, tenantName, tenantLogoUrl, onSave }: ItineraryBuilderProps) {
  const cf = (lead.custom_fields || {}) as Record<string, unknown>;
  const nights = computeNights(lead);
  const stored = parseStoredItinerary(lead);

  const [itinerary, setItinerary] = useState<Itinerary>(
    stored ?? emptyItinerary(cf.trip_destination ? String(cf.trip_destination) : undefined, nights)
  );
  const [saving, setSaving] = useState(false);
  const [showProposal, setShowProposal] = useState(false);

  function update(patch: Partial<Itinerary>) {
    setItinerary((prev) => ({ ...prev, ...patch }));
  }

  // ── Days ──────────────────────────────────────────────────────────────────

  function addDay() {
    const next: ItineraryDay = {
      id: uid(),
      title: `Day ${itinerary.days.length + 1}`,
      description: "",
    };
    update({ days: [...itinerary.days, next] });
  }

  function removeDay(id: string) {
    update({ days: itinerary.days.filter((d) => d.id !== id) });
  }

  function moveDay(id: string, dir: "up" | "down") {
    const days = [...itinerary.days];
    const idx = days.findIndex((d) => d.id === id);
    if (dir === "up" && idx === 0) return;
    if (dir === "down" && idx === days.length - 1) return;
    const swap = dir === "up" ? idx - 1 : idx + 1;
    [days[idx], days[swap]] = [days[swap], days[idx]];
    update({ days });
  }

  function patchDay(id: string, patch: Partial<ItineraryDay>) {
    update({
      days: itinerary.days.map((d) => (d.id === id ? { ...d, ...patch } : d)),
    });
  }

  // ── Line items ────────────────────────────────────────────────────────────

  function addLineItem() {
    const next: ItineraryLineItem = {
      id: uid(),
      category: "hotel",
      label: "",
      qty: 1,
      unitPrice: 0,
    };
    update({ lineItems: [...itinerary.lineItems, next] });
  }

  function removeLineItem(id: string) {
    update({ lineItems: itinerary.lineItems.filter((i) => i.id !== id) });
  }

  function patchItem(id: string, patch: Partial<ItineraryLineItem>) {
    update({
      lineItems: itinerary.lineItems.map((i) => (i.id === id ? { ...i, ...patch } : i)),
    });
  }

  // ── Save ──────────────────────────────────────────────────────────────────

  async function handleSave() {
    setSaving(true);
    try {
      const toSave: Itinerary = { ...itinerary, updatedAt: new Date().toISOString() };
      await onSave(toSave);
      setItinerary(toSave);
      toast.success("Itinerary saved");
    } catch {
      toast.error("Failed to save itinerary");
    } finally {
      setSaving(false);
    }
  }

  const total = grandTotal(itinerary.lineItems);

  if (showProposal) {
    return (
      <ItineraryProposal
        itinerary={itinerary}
        lead={lead}
        tenantName={tenantName}
        tenantLogoUrl={tenantLogoUrl}
        onBack={() => setShowProposal(false)}
      />
    );
  }

  return (
    <div className="space-y-6">
      {/* Header row */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div className="flex-1 min-w-0">
          <p className="text-xs text-muted-foreground mb-1">Itinerary title</p>
          <Input
            className="text-base font-semibold"
            value={itinerary.title}
            onChange={(e) => update({ title: e.target.value })}
          />
        </div>
        <div className="flex gap-2 shrink-0">
          <Button
            variant="outline"
            size="sm"
            className="gap-1.5"
            onClick={() => setShowProposal(true)}
          >
            <Printer className="h-4 w-4" />
            View Proposal
          </Button>
          <Button size="sm" onClick={handleSave} disabled={saving}>
            {saving ? "Saving…" : "Save"}
          </Button>
        </div>
      </div>

      {/* Days */}
      <section>
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold">Day-by-Day Itinerary</h3>
          <Button variant="outline" size="sm" className="gap-1.5" onClick={addDay}>
            <Plus className="h-3.5 w-3.5" />
            Add Day
          </Button>
        </div>
        {itinerary.days.length === 0 ? (
          <p className="text-sm text-muted-foreground italic text-center py-4 border border-dashed rounded-lg">
            No days yet. Click &ldquo;Add Day&rdquo; to start building the itinerary.
          </p>
        ) : (
          <div className="space-y-3">
            {itinerary.days.map((day, idx) => (
              <div key={day.id} className="border border-border rounded-lg p-3 space-y-2 bg-card">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-medium text-muted-foreground w-12 shrink-0">
                    Day {idx + 1}
                  </span>
                  <Input
                    className="h-7 text-sm flex-1"
                    value={day.title}
                    placeholder="Day title"
                    onChange={(e) => patchDay(day.id, { title: e.target.value })}
                  />
                  <div className="flex gap-1 shrink-0">
                    <button
                      type="button"
                      onClick={() => moveDay(day.id, "up")}
                      disabled={idx === 0}
                      className="p-1 rounded hover:bg-muted disabled:opacity-30"
                    >
                      <ChevronUp className="h-3.5 w-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => moveDay(day.id, "down")}
                      disabled={idx === itinerary.days.length - 1}
                      className="p-1 rounded hover:bg-muted disabled:opacity-30"
                    >
                      <ChevronDown className="h-3.5 w-3.5" />
                    </button>
                    <button
                      type="button"
                      onClick={() => removeDay(day.id)}
                      className="p-1 rounded hover:bg-muted text-destructive"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
                <Textarea
                  className="text-sm min-h-[56px] resize-none"
                  value={day.description}
                  placeholder="Describe activities, accommodation, meals for this day…"
                  onChange={(e) => patchDay(day.id, { description: e.target.value })}
                />
              </div>
            ))}
          </div>
        )}
      </section>

      {/* Line items */}
      <section>
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold">Pricing</h3>
          <Button variant="outline" size="sm" className="gap-1.5" onClick={addLineItem}>
            <Plus className="h-3.5 w-3.5" />
            Add Item
          </Button>
        </div>
        {itinerary.lineItems.length === 0 ? (
          <p className="text-sm text-muted-foreground italic text-center py-4 border border-dashed rounded-lg">
            No line items yet. Click &ldquo;Add Item&rdquo; to add costs.
          </p>
        ) : (
          <div className="space-y-2">
            {/* Header */}
            <div className="grid grid-cols-[120px_1fr_64px_96px_80px_32px] gap-2 px-2">
              {["Category", "Label", "Qty", "Unit Price", "Total", ""].map((h) => (
                <p key={h} className="text-[10px] font-medium text-muted-foreground uppercase">{h}</p>
              ))}
            </div>
            {itinerary.lineItems.map((item) => (
              <div
                key={item.id}
                className="grid grid-cols-[120px_1fr_64px_96px_80px_32px] gap-2 items-center"
              >
                <Select
                  value={item.category}
                  onValueChange={(v) =>
                    patchItem(item.id, { category: v as ItineraryLineItem["category"] })
                  }
                >
                  <SelectTrigger className="h-7 text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {LINE_ITEM_CATEGORIES.map((c) => (
                      <SelectItem key={c.value} value={c.value}>
                        {c.label}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <Input
                  className="h-7 text-xs"
                  value={item.label}
                  placeholder="Description"
                  onChange={(e) => patchItem(item.id, { label: e.target.value })}
                />
                <Input
                  type="number"
                  min="1"
                  className="h-7 text-xs text-right"
                  value={item.qty}
                  onChange={(e) =>
                    patchItem(item.id, { qty: Math.max(1, Number(e.target.value)) })
                  }
                />
                <Input
                  type="number"
                  min="0"
                  className="h-7 text-xs text-right"
                  value={item.unitPrice}
                  onChange={(e) =>
                    patchItem(item.id, { unitPrice: Math.max(0, Number(e.target.value)) })
                  }
                />
                <p className="text-xs font-medium text-right pr-1">
                  {formatMoney(lineItemTotal(item), itinerary.currency)}
                </p>
                <button
                  type="button"
                  onClick={() => removeLineItem(item.id)}
                  className="p-1 rounded hover:bg-muted text-destructive"
                >
                  <Trash2 className="h-3.5 w-3.5" />
                </button>
              </div>
            ))}
            <div className="flex justify-end pt-2 border-t border-border">
              <div className="text-right">
                <p className="text-xs text-muted-foreground">Grand Total</p>
                <p className="text-base font-bold">{formatMoney(total, itinerary.currency)}</p>
              </div>
            </div>
          </div>
        )}
      </section>

      {/* Notes */}
      <section>
        <h3 className="text-sm font-semibold mb-2">Notes / Terms</h3>
        <Textarea
          className="min-h-[80px] text-sm"
          value={itinerary.notes}
          placeholder="Inclusions, exclusions, cancellation policy…"
          onChange={(e) => update({ notes: e.target.value })}
        />
      </section>

      {/* Save */}
      <div className="flex justify-end gap-2">
        <Button
          variant="outline"
          size="sm"
          className="gap-1.5"
          onClick={() => setShowProposal(true)}
        >
          <Printer className="h-4 w-4" />
          View Proposal
        </Button>
        <Button onClick={handleSave} disabled={saving}>
          {saving ? "Saving…" : "Save Itinerary"}
        </Button>
      </div>
    </div>
  );
}
