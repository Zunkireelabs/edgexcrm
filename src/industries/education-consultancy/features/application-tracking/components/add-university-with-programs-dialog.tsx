"use client";

import { useState, useEffect } from "react";
import { X } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import type { PartnerCollegeOption, ProgramOption } from "../hooks/use-application-reference-data";

interface AddUniversityWithProgramsDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Prefilled from the text typed into the University AutocompleteInput. */
  initialName: string;
  countries: string[];
  createPartnerCollege: (name: string, country: string | null) => Promise<PartnerCollegeOption | null>;
  createProgram: (universityId: string, name: string) => Promise<ProgramOption | null>;
  fetchDistinctProgramNames: () => Promise<string[]>;
  onCreated: (result: { university: PartnerCollegeOption; programs: ProgramOption[] }) => void;
}

// Replaces the plain University create-confirm on Add-Application: a University with
// no programs attached is a dead end (Program picker stays empty), so this collects at
// least one program in the same step — picked from the tenant's existing program names
// or typed fresh — and links them all to the new University in one save.
export function AddUniversityWithProgramsDialog({
  open,
  onOpenChange,
  initialName,
  countries,
  createPartnerCollege,
  createProgram,
  fetchDistinctProgramNames,
  onCreated,
}: AddUniversityWithProgramsDialogProps) {
  const [name, setName] = useState(initialName);
  const [country, setCountry] = useState("");
  const [existingNames, setExistingNames] = useState<string[]>([]);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [newProgramInput, setNewProgramInput] = useState("");
  const [customPrograms, setCustomPrograms] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (open) {
      setName(initialName);
      setCountry("");
      setSelected(new Set());
      setNewProgramInput("");
      setCustomPrograms([]);
      fetchDistinctProgramNames().then(setExistingNames);
    }
    // fetchDistinctProgramNames is a new closure each render — depending on it would
    // refire this effect on every parent re-render while the dialog stays open.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, initialName]);

  function toggleExisting(pname: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(pname)) next.delete(pname);
      else next.add(pname);
      return next;
    });
  }

  function addCustomProgram() {
    const trimmed = newProgramInput.trim();
    if (!trimmed) return;
    const alreadyIncluded =
      customPrograms.some((p) => p.toLowerCase() === trimmed.toLowerCase()) ||
      [...selected].some((p) => p.toLowerCase() === trimmed.toLowerCase());
    if (!alreadyIncluded) setCustomPrograms((prev) => [...prev, trimmed]);
    setNewProgramInput("");
  }

  function removeCustomProgram(pname: string) {
    setCustomPrograms((prev) => prev.filter((p) => p !== pname));
  }

  const allProgramNames = [...new Set([...selected, ...customPrograms])];
  const canSave = name.trim().length > 0 && allProgramNames.length > 0 && !saving;

  async function handleSave() {
    if (!canSave) return;
    setSaving(true);
    try {
      const college = await createPartnerCollege(name.trim(), country || null);
      if (!college) return;
      const results = await Promise.all(allProgramNames.map((pname) => createProgram(college.id, pname)));
      const createdPrograms = results.filter((p): p is ProgramOption => p !== null);
      if (createdPrograms.length === 0) {
        toast.error("University created, but no programs were added");
      }
      onCreated({ university: college, programs: createdPrograms });
      onOpenChange(false);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={(v) => { if (!saving) onOpenChange(v); }}>
      <DialogContent className="max-w-md" onClick={(e) => e.stopPropagation()}>
        <DialogHeader>
          <DialogTitle>Add University</DialogTitle>
          <DialogDescription>
            Create a new university and link at least one program to it.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-2">
          <div className="space-y-1.5">
            <Label>
              University Name <span className="text-destructive">*</span>
            </Label>
            <Input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. University of Melbourne"
              disabled={saving}
            />
          </div>

          <div className="space-y-1.5">
            <Label>Country</Label>
            <Select
              value={country || "__none__"}
              onValueChange={(v) => setCountry(v === "__none__" ? "" : v)}
              disabled={saving}
            >
              <SelectTrigger>
                <SelectValue placeholder="Select country" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__none__">
                  <span className="text-muted-foreground">Not set</span>
                </SelectItem>
                {countries.map((c) => (
                  <SelectItem key={c} value={c}>{c}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div className="space-y-1.5">
            <Label>
              Programs <span className="text-destructive">*</span>
            </Label>
            {existingNames.length > 0 && (
              <div className="border border-input rounded-md p-2 grid grid-cols-2 gap-1.5 max-h-36 overflow-y-auto">
                {existingNames.map((pname) => (
                  <div key={pname} className="flex items-center gap-2">
                    <Checkbox
                      id={`prog-${pname}`}
                      checked={selected.has(pname)}
                      disabled={saving}
                      onCheckedChange={() => toggleExisting(pname)}
                    />
                    <label htmlFor={`prog-${pname}`} className="text-xs cursor-pointer truncate">
                      {pname}
                    </label>
                  </div>
                ))}
              </div>
            )}
            <div className="flex gap-2">
              <Input
                value={newProgramInput}
                onChange={(e) => setNewProgramInput(e.target.value)}
                placeholder="Type a new program name..."
                disabled={saving}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    addCustomProgram();
                  }
                }}
              />
              <Button type="button" variant="outline" onClick={addCustomProgram} disabled={saving}>
                Add
              </Button>
            </div>
            {customPrograms.length > 0 && (
              <div className="flex flex-wrap gap-1.5 pt-1">
                {customPrograms.map((pname) => (
                  <span
                    key={pname}
                    className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-primary/10 text-primary text-xs"
                  >
                    {pname}
                    <button
                      type="button"
                      onClick={() => removeCustomProgram(pname)}
                      className="hover:text-destructive"
                      disabled={saving}
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </span>
                ))}
              </div>
            )}
            {allProgramNames.length === 0 && (
              <p className="text-xs text-muted-foreground">Select or type at least one program.</p>
            )}
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={!canSave}>
            {saving ? "Creating…" : "Create University"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
