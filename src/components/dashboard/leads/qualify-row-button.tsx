"use client";

import { useState } from "react";
import { CircleNotchIcon } from "@/components/icons";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "sonner";
import type { LeadList } from "@/types/database";
import { useEduTaxonomy } from "@/hooks/use-edu-taxonomy";
import { DestinationsMultiSelect } from "@/components/dashboard/destinations-multi-select";

interface QualifyRowButtonProps {
  leadId: string;
  currentDestinations: string[];
  currentFieldOfStudy: string | null;
  currentDegreeLevel: string | null;
  qualifiedList: LeadList;
  onQualified: (qualifiedListId: string) => Promise<void>;
  /** Leads table v2: a quiet 24px control that fits the 36px row. */
  quiet?: boolean;
}

export function QualifyRowButton({
  leadId,
  currentDestinations,
  currentFieldOfStudy,
  currentDegreeLevel,
  qualifiedList,
  onQualified,
  quiet = false,
}: QualifyRowButtonProps) {
  const { destinations: destOptions, fieldsOfStudy, studyLevels } = useEduTaxonomy();
  const [open, setOpen] = useState(false);
  const [dests, setDests] = useState<string[]>(currentDestinations);
  const [fieldOfStudy, setFieldOfStudy] = useState(currentFieldOfStudy ?? "");
  const [degreeLevel, setDegreeLevel] = useState(currentDegreeLevel ?? "");
  const [note, setNote] = useState("");
  const [qualifying, setQualifying] = useState(false);

  function openDialog(e: React.MouseEvent) {
    e.stopPropagation();
    setDests(currentDestinations);
    setFieldOfStudy(currentFieldOfStudy ?? "");
    setDegreeLevel(currentDegreeLevel ?? "");
    setNote("");
    setOpen(true);
  }

  async function handleSubmit() {
    setQualifying(true);
    try {
      const res = await fetch(`/api/v1/leads/${leadId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          list_id: qualifiedList.id,
          destinations: dests,
          field_of_study: fieldOfStudy || null,
          degree_level: degreeLevel || null,
        }),
      });
      if (!res.ok) throw new Error("Failed to qualify lead");

      if (note.trim()) {
        const noteRes = await fetch(`/api/v1/leads/${leadId}/notes`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ content: note.trim() }),
        });
        if (!noteRes.ok) throw new Error("Failed to add note");
      }

      await onQualified(qualifiedList.id);
      toast.success(`Moved to ${qualifiedList.name}`);
      setOpen(false);
    } catch {
      toast.error("Failed to qualify lead");
    } finally {
      setQualifying(false);
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={openDialog}
        className={
          quiet
            ? "inline-flex h-6 shrink-0 items-center rounded-ds-xs px-2 text-xs font-medium text-ds-accent transition-colors hover:bg-ds-accent-soft focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ds-ghost"
            : "inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-emerald-50 text-emerald-700 hover:bg-emerald-100 transition-colors"
        }
      >
        Qualify →
      </button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-w-md" onClick={(e) => e.stopPropagation()}>
          <DialogHeader>
            <DialogTitle>Qualify Lead</DialogTitle>
          </DialogHeader>

          <div className="space-y-4 py-2">
            <DestinationsMultiSelect
              selected={dests}
              onChange={setDests}
              options={destOptions}
              label="Interested destinations"
              optional={false}
            />

            <div className="space-y-1.5">
              <Label>Field of study</Label>
              <SearchableSelect
                options={[{ value: "__none__", label: "Not specified" }, ...fieldsOfStudy.map((x) => ({ value: x, label: x }))]}
                value={fieldOfStudy}
                onValueChange={(v) => setFieldOfStudy(v === "__none__" ? "" : v)}
                placeholder="Select field"
                searchPlaceholder="Search fields…"
              />
            </div>

            <div className="space-y-1.5">
              <Label>Degree level</Label>
              <SearchableSelect
                options={[{ value: "__none__", label: "Not specified" }, ...studyLevels.map((x) => ({ value: x, label: x }))]}
                value={degreeLevel}
                onValueChange={(v) => setDegreeLevel(v === "__none__" ? "" : v)}
                placeholder="Select level"
                searchPlaceholder="Search levels…"
              />
            </div>

            <div className="space-y-1.5">
              <Label>Note <span className="font-normal">(optional)</span></Label>
              <Textarea
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="Add a note about this qualification…"
                rows={3}
                className="resize-none"
              />
            </div>
          </div>

          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)} disabled={qualifying}>
              Cancel
            </Button>
            <Button onClick={handleSubmit} disabled={qualifying}>
              {qualifying ? (
                <>
                  <CircleNotchIcon className="h-4 w-4 mr-2 animate-spin" />
                  Qualifying…
                </>
              ) : (
                "Qualify →"
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
