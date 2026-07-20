"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  INVESTOR_TYPES,
  ACCREDITATION_STATUSES,
  KYC_STATUSES,
  INVESTOR_FIELD_KEYS,
  INVESTOR_TYPE_LABELS,
  ACCREDITATION_LABELS,
  KYC_LABELS,
  labelFor,
} from "@/industries/real-estate/lib/investor-fields";
import { formatCurrency } from "@/industries/real-estate/lib/commitments";

type CustomFields = Record<string, unknown>;

function str(cf: CustomFields, key: string): string {
  const v = cf[key];
  return v == null ? "" : String(v);
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-2">
      <span className="text-xs text-muted-foreground">{label}</span>
      <span className="text-sm font-medium text-right">{value}</span>
    </div>
  );
}

export function InvestorProfileCard({
  leadId,
  customFields,
  canEdit,
}: {
  leadId: string;
  customFields: CustomFields;
  canEdit: boolean;
}) {
  const [cf, setCf] = useState<CustomFields>(customFields || {});
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<CustomFields>(cf);
  const [saving, setSaving] = useState(false);

  const K = INVESTOR_FIELD_KEYS;

  function startEdit() {
    setDraft(cf);
    setEditing(true);
  }

  function setDraftField(key: string, value: string) {
    setDraft((d) => ({ ...d, [key]: value === "" ? null : value }));
  }

  async function save() {
    setSaving(true);
    try {
      const merged = { ...cf, ...draft };
      const res = await fetch(`/api/v1/leads/${leadId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ custom_fields: merged }),
      });
      if (!res.ok) throw new Error();
      setCf(merged);
      setEditing(false);
      toast.success("Investor profile saved");
    } catch {
      toast.error("Failed to save investor profile");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="border border-border rounded-lg bg-card">
      <div className="flex items-center justify-between p-3 border-b">
        <h3 className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide">
          Investor Profile
        </h3>
        {canEdit && !editing && (
          <Button variant="ghost" size="sm" className="h-6 text-xs" onClick={startEdit}>
            Edit
          </Button>
        )}
      </div>

      <div className="p-3 space-y-3">
        {editing ? (
          <>
            <div className="space-y-1.5">
              <Label>Investor Type</Label>
              <Select value={str(draft, K.investorType)} onValueChange={(v) => setDraftField(K.investorType, v)}>
                <SelectTrigger><SelectValue placeholder="Select…" /></SelectTrigger>
                <SelectContent>
                  {INVESTOR_TYPES.map((t) => (
                    <SelectItem key={t} value={t}>{INVESTOR_TYPE_LABELS[t]}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>Accreditation</Label>
              <Select value={str(draft, K.accreditationStatus)} onValueChange={(v) => setDraftField(K.accreditationStatus, v)}>
                <SelectTrigger><SelectValue placeholder="Select…" /></SelectTrigger>
                <SelectContent>
                  {ACCREDITATION_STATUSES.map((t) => (
                    <SelectItem key={t} value={t}>{ACCREDITATION_LABELS[t]}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label>KYC / AML</Label>
              <Select value={str(draft, K.kycStatus)} onValueChange={(v) => setDraftField(K.kycStatus, v)}>
                <SelectTrigger><SelectValue placeholder="Select…" /></SelectTrigger>
                <SelectContent>
                  {KYC_STATUSES.map((t) => (
                    <SelectItem key={t} value={t}>{KYC_LABELS[t]}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="inv-entity">Entity Name</Label>
              <Input id="inv-entity" value={str(draft, K.entityName)} onChange={(e) => setDraftField(K.entityName, e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="inv-check">Target Check Size ($)</Label>
              <Input id="inv-check" type="number" value={str(draft, K.targetCheckSize)} onChange={(e) => setDraftField(K.targetCheckSize, e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="inv-asset">Preferred Asset Class</Label>
              <Input id="inv-asset" value={str(draft, K.preferredAssetClass)} onChange={(e) => setDraftField(K.preferredAssetClass, e.target.value)} placeholder="industrial" />
            </div>
            <div className="flex justify-end gap-2 pt-1">
              <Button variant="outline" size="sm" onClick={() => setEditing(false)} disabled={saving}>
                Cancel
              </Button>
              <Button size="sm" onClick={save} disabled={saving}>
                {saving ? "Saving…" : "Save"}
              </Button>
            </div>
          </>
        ) : (
          <>
            <Row label="Investor Type" value={labelFor(str(cf, K.investorType) || null, INVESTOR_TYPE_LABELS)} />
            <Row label="Accreditation" value={labelFor(str(cf, K.accreditationStatus) || null, ACCREDITATION_LABELS)} />
            <Row label="KYC / AML" value={labelFor(str(cf, K.kycStatus) || null, KYC_LABELS)} />
            <Row label="Entity Name" value={str(cf, K.entityName) || "—"} />
            <Row
              label="Target Check"
              value={str(cf, K.targetCheckSize) ? formatCurrency(Number(str(cf, K.targetCheckSize))) : "—"}
            />
            <Row
              label="Preferred Asset"
              value={str(cf, K.preferredAssetClass) || "—"}
            />
          </>
        )}
      </div>
    </div>
  );
}
