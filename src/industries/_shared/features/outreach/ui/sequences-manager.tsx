"use client";

import { useState } from "react";
import { Plus, Pencil, Archive, Layers } from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { toast } from "sonner";
import { useSequences, type Sequence } from "../hooks/use-sequences";
import { SequenceEditorDialog } from "./sequence-editor-dialog";
import { formatDate } from "../lib/format-due";

interface SequencesManagerProps {
  isAdmin: boolean;
}

export function SequencesManager({ isAdmin }: SequencesManagerProps) {
  const { sequences, loading, refresh } = useSequences();
  const [editorOpen, setEditorOpen] = useState(false);
  const [editingSequence, setEditingSequence] = useState<Sequence | null>(null);
  const [archiveTarget, setArchiveTarget] = useState<Sequence | null>(null);

  const openCreate = () => {
    setEditingSequence(null);
    setEditorOpen(true);
  };

  const openEdit = (sequence: Sequence) => {
    setEditingSequence(sequence);
    setEditorOpen(true);
  };

  const confirmArchive = async () => {
    if (!archiveTarget) return;
    const res = await fetch(`/api/v1/outreach/sequences/${archiveTarget.id}`, { method: "DELETE" });
    if (!res.ok) {
      const json = await res.json().catch(() => null);
      toast.error(json?.error?.message ?? "Failed to archive sequence");
      return;
    }
    toast.success("Sequence archived");
    setArchiveTarget(null);
    refresh();
  };

  return (
    <div className="space-y-3">
      {isAdmin && (
        <div className="flex justify-end">
          <Button type="button" size="sm" onClick={openCreate}>
            <Plus className="h-3.5 w-3.5 mr-1.5" /> New sequence
          </Button>
        </div>
      )}

      {loading ? (
        <Card className="shadow-none rounded-lg py-0">
          <CardContent className="p-8 text-center text-muted-foreground">Loading sequences...</CardContent>
        </Card>
      ) : sequences.length === 0 ? (
        <Card className="shadow-none rounded-lg py-0">
          <CardContent className="p-8 text-center">
            <Layers className="h-8 w-8 text-muted-foreground mx-auto mb-2" />
            <p className="text-muted-foreground">
              {isAdmin ? "No sequences yet. Create one to start automating follow-ups." : "No sequences available."}
            </p>
          </CardContent>
        </Card>
      ) : (
        <div className="divide-y rounded-lg border">
          {sequences.map((sequence) => (
            <div key={sequence.id} className="flex items-center justify-between gap-4 px-4 py-3">
              <div className="min-w-0">
                <p className="font-medium text-sm truncate">{sequence.name}</p>
                {sequence.description && (
                  <p className="text-sm text-muted-foreground truncate">{sequence.description}</p>
                )}
                <p className="text-xs text-muted-foreground">
                  {sequence.email_sequence_steps.length} step
                  {sequence.email_sequence_steps.length === 1 ? "" : "s"} · created {formatDate(sequence.created_at)}
                </p>
              </div>
              {isAdmin && (
                <div className="shrink-0 flex items-center gap-1">
                  <Button type="button" variant="ghost" size="sm" onClick={() => openEdit(sequence)}>
                    <Pencil className="h-3.5 w-3.5 mr-1.5" /> Edit
                  </Button>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="text-destructive hover:text-destructive"
                    onClick={() => setArchiveTarget(sequence)}
                  >
                    <Archive className="h-3.5 w-3.5 mr-1.5" /> Archive
                  </Button>
                </div>
              )}
            </div>
          ))}
        </div>
      )}

      <SequenceEditorDialog
        open={editorOpen}
        onOpenChange={setEditorOpen}
        sequence={editingSequence}
        onSaved={refresh}
      />

      <AlertDialog open={!!archiveTarget} onOpenChange={(open) => !open && setArchiveTarget(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Archive &ldquo;{archiveTarget?.name}&rdquo;?</AlertDialogTitle>
            <AlertDialogDescription>
              This removes it from the sequence picker. Leads already enrolled keep running their cadence.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={confirmArchive}>Archive</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
