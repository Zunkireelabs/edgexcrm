"use client";

import { useState } from "react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  OFFERING_STRUCTURES,
  OFFERING_EXEMPTIONS,
} from "@/industries/real-estate/lib/commitments";

interface Props {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onCreated: () => void;
}

export function CreateOfferingDialog({ open, onOpenChange, onCreated }: Props) {
  const [name, setName] = useState("");
  const [assetClass, setAssetClass] = useState("industrial");
  const [structure, setStructure] = useState<string>("");
  const [exemption, setExemption] = useState<string>("");
  const [targetRaise, setTargetRaise] = useState("");
  const [minInvestment, setMinInvestment] = useState("");
  const [prefReturn, setPrefReturn] = useState("");
  const [description, setDescription] = useState("");
  const [saving, setSaving] = useState(false);

  function reset() {
    setName("");
    setAssetClass("industrial");
    setStructure("");
    setExemption("");
    setTargetRaise("");
    setMinInvestment("");
    setPrefReturn("");
    setDescription("");
  }

  async function handleSubmit() {
    if (!name.trim()) {
      toast.error("Name is required");
      return;
    }
    setSaving(true);
    try {
      const body: Record<string, unknown> = { name: name.trim(), asset_class: assetClass.trim() };
      if (structure) body.structure = structure;
      if (exemption) body.exemption = exemption;
      if (targetRaise) body.target_raise = Number(targetRaise);
      if (minInvestment) body.min_investment = Number(minInvestment);
      if (prefReturn) body.pref_return = Number(prefReturn);
      if (description.trim()) body.description = description.trim();

      const res = await fetch("/api/v1/offerings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error("Failed to create offering");
      toast.success("Offering created");
      reset();
      onOpenChange(false);
      onCreated();
    } catch {
      toast.error("Failed to create offering");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>New Offering</DialogTitle>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="space-y-1.5">
            <Label htmlFor="offering-name">Name</Label>
            <Input
              id="offering-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Industrial Value-Add Fund II"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="offering-asset-class">Asset Class</Label>
              <Input
                id="offering-asset-class"
                value={assetClass}
                onChange={(e) => setAssetClass(e.target.value)}
                placeholder="industrial"
              />
            </div>
            <div className="space-y-1.5">
              <Label>Structure</Label>
              <Select value={structure} onValueChange={setStructure}>
                <SelectTrigger>
                  <SelectValue placeholder="Select…" />
                </SelectTrigger>
                <SelectContent>
                  {OFFERING_STRUCTURES.map((s) => (
                    <SelectItem key={s} value={s}>
                      {s.replace(/_/g, " ")}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label>Exemption</Label>
              <Select value={exemption} onValueChange={setExemption}>
                <SelectTrigger>
                  <SelectValue placeholder="Select…" />
                </SelectTrigger>
                <SelectContent>
                  {OFFERING_EXEMPTIONS.map((e) => (
                    <SelectItem key={e} value={e}>
                      Reg D {e}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="offering-pref">Pref Return (%)</Label>
              <Input
                id="offering-pref"
                type="number"
                value={prefReturn}
                onChange={(e) => setPrefReturn(e.target.value)}
                placeholder="8"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="offering-target">Target Raise ($)</Label>
              <Input
                id="offering-target"
                type="number"
                value={targetRaise}
                onChange={(e) => setTargetRaise(e.target.value)}
                placeholder="25000000"
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="offering-min">Min Investment ($)</Label>
              <Input
                id="offering-min"
                type="number"
                value={minInvestment}
                onChange={(e) => setMinInvestment(e.target.value)}
                placeholder="50000"
              />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="offering-desc">Description</Label>
            <Textarea
              id="offering-desc"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
              placeholder="Value-add industrial across the Southeast US…"
            />
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={handleSubmit} disabled={saving}>
            {saving ? "Creating…" : "Create Offering"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
