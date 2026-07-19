"use client";

import { useState } from "react";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import { createClient } from "@/lib/supabase/client";
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
}

export function QualifyRowButton({
  leadId,
  currentDestinations,
  currentFieldOfStudy,
  currentDegreeLevel,
  qualifiedList,
  onQualified,
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

  function toggleDest(dest: string) {
    setDests((prev) =>
      prev.includes(dest) ? prev.filter((d) => d !== dest) : [...prev, dest]
    );
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
        const supabase = createClient();
        const { data: { user } } = await supabase.auth.getUser();
        if (user) {
          await supabase.from("lead_notes").insert({
            lead_id: leadId,
            user_id: user.id,
            user_email: user.email ?? "",
            content: note.trim(),
          });
        }
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
        className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold bg-emerald-50 text-emerald-700 hover:bg-emerald-100 transition-colors"
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
              onToggle={toggleDest}
              options={destOptions}
              label="Interested Destinations"
              optional={false}
            />

            <div className="space-y-1.5">
              <p className="text-sm font-medium">Field of Study</p>
              <Select value={fieldOfStudy || "__none__"} onValueChange={(v) => setFieldOfStudy(v === "__none__" ? "" : v)}>
                <SelectTrigger>
                  <SelectValue placeholder="Select field" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">
                    <span className="text-muted-foreground">Not specified</span>
                  </SelectItem>
                  {fieldsOfStudy.map((f) => (
                    <SelectItem key={f} value={f}>{f}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <p className="text-sm font-medium">Degree Level</p>
              <Select value={degreeLevel || "__none__"} onValueChange={(v) => setDegreeLevel(v === "__none__" ? "" : v)}>
                <SelectTrigger>
                  <SelectValue placeholder="Select level" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="__none__">
                    <span className="text-muted-foreground">Not specified</span>
                  </SelectItem>
                  {studyLevels.map((lvl) => (
                    <SelectItem key={lvl} value={lvl}>{lvl}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="space-y-1.5">
              <p className="text-sm font-medium">Note <span className="text-muted-foreground font-normal">(optional)</span></p>
              <textarea
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="Add a note about this qualification…"
                rows={3}
                className="w-full px-3 py-2 text-sm border border-input rounded-md bg-background focus:outline-none focus:ring-2 focus:ring-ring resize-none"
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
                  <Loader2 className="h-4 w-4 mr-2 animate-spin" />
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
