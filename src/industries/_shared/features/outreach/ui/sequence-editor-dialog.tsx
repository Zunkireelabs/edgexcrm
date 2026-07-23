"use client";

import { useState, useRef, useEffect } from "react";
import { Plus, Trash2, ChevronUp, ChevronDown, Loader2 } from "lucide-react";
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
import { Checkbox } from "@/components/ui/checkbox";
import { Card, CardContent } from "@/components/ui/card";
import { toast } from "sonner";
import { TipTapEditor, type TipTapEditorHandle } from "@/industries/_shared/features/email/components/tiptap-editor";
import type { Sequence } from "../hooks/use-sequences";

const MERGE_TAGS = ["first_name", "last_name", "email", "phone", "city", "country", "tenant_name"];

interface StepDraft {
  key: string;
  delay_days: number;
  subject_template: string;
  body_template: string;
  draft_source: "template" | "ai";
  ai_instructions: string;
}

interface SequenceEditorDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  sequence: Sequence | null;
  onSaved: () => void;
}

let keyCounter = 0;
function newKey() {
  keyCounter += 1;
  return `step-${keyCounter}`;
}

function stepsFromSequence(sequence: Sequence | null): StepDraft[] {
  if (!sequence) {
    return [{ key: newKey(), delay_days: 0, subject_template: "", body_template: "", draft_source: "template", ai_instructions: "" }];
  }
  return [...sequence.email_sequence_steps]
    .sort((a, b) => a.step_order - b.step_order)
    .map((s) => ({
      key: newKey(),
      delay_days: s.delay_days,
      subject_template: s.subject_template,
      body_template: s.body_template,
      draft_source: s.draft_source ?? "template",
      ai_instructions: s.ai_instructions ?? "",
    }));
}

export function SequenceEditorDialog({ open, onOpenChange, sequence, onSaved }: SequenceEditorDialogProps) {
  const isEdit = !!sequence;
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [steps, setSteps] = useState<StepDraft[]>([]);
  const [saving, setSaving] = useState(false);
  const [lastFocused, setLastFocused] = useState<{ index: number; field: "subject" | "body" } | null>(null);

  const subjectRefs = useRef<Record<number, HTMLInputElement | null>>({});
  const bodyRefs = useRef<Record<number, TipTapEditorHandle | null>>({});

  useEffect(() => {
    if (open) {
      setName(sequence?.name ?? "");
      setDescription(sequence?.description ?? "");
      setSteps(stepsFromSequence(sequence));
      setLastFocused(null);
    }
  }, [open, sequence]);

  const updateStep = (index: number, patch: Partial<StepDraft>) => {
    setSteps((prev) => prev.map((s, i) => (i === index ? { ...s, ...patch } : s)));
  };

  const addStep = () => {
    setSteps((prev) => [
      ...prev,
      { key: newKey(), delay_days: 3, subject_template: "", body_template: "", draft_source: "template", ai_instructions: "" },
    ]);
  };

  const removeStep = (index: number) => {
    setSteps((prev) => prev.filter((_, i) => i !== index));
  };

  const moveStep = (index: number, dir: -1 | 1) => {
    setSteps((prev) => {
      const next = [...prev];
      const target = index + dir;
      if (target < 0 || target >= next.length) return prev;
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  };

  const insertToken = (token: string) => {
    if (!lastFocused) {
      toast.info("Click into a subject or body field first");
      return;
    }
    const tag = `{{${token}}}`;
    const { index, field } = lastFocused;

    if (field === "subject") {
      const el = subjectRefs.current[index];
      const current = steps[index]?.subject_template ?? "";
      const start = el?.selectionStart ?? current.length;
      const end = el?.selectionEnd ?? current.length;
      const next = current.slice(0, start) + tag + current.slice(end);
      updateStep(index, { subject_template: next });
      requestAnimationFrame(() => {
        el?.focus();
        el?.setSelectionRange(start + tag.length, start + tag.length);
      });
    } else {
      bodyRefs.current[index]?.insertText(tag);
    }
  };

  const handleSave = async () => {
    if (!name.trim()) {
      toast.error("Name is required");
      return;
    }
    if (steps.length === 0) {
      toast.error("Add at least one step");
      return;
    }
    const missingInstructions = steps.find((s) => s.draft_source === "ai" && !s.ai_instructions.trim());
    if (missingInstructions) {
      toast.error("Add AI instructions for every step with auto-draft enabled");
      return;
    }

    const payload = {
      name: name.trim(),
      description: description.trim() || undefined,
      steps: steps.map((s, i) => ({
        step_order: i + 1,
        delay_days: i === 0 ? 0 : s.delay_days,
        subject_template: s.subject_template,
        body_template: s.body_template,
        draft_source: s.draft_source,
        ai_instructions: s.ai_instructions.trim() || null,
      })),
    };

    setSaving(true);
    try {
      const url = isEdit ? `/api/v1/outreach/sequences/${sequence!.id}` : "/api/v1/outreach/sequences";
      const method = isEdit ? "PATCH" : "POST";
      const res = await fetch(url, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const json = await res.json();

      if (!res.ok) {
        if (res.status === 409) {
          toast.error("Can't edit steps while leads are enrolled");
        } else {
          toast.error(json?.error?.message ?? "Failed to save sequence");
        }
        return;
      }

      toast.success(isEdit ? "Sequence updated" : "Sequence created");
      onSaved();
      onOpenChange(false);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl max-h-[90vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>{isEdit ? "Edit sequence" : "New sequence"}</DialogTitle>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto space-y-4 py-2">
          <div className="space-y-1.5">
            <Label htmlFor="seq-name">Name</Label>
            <Input id="seq-name" value={name} onChange={(e) => setName(e.target.value)} placeholder="New lead follow-up" />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="seq-description">Description</Label>
            <Input
              id="seq-description"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Optional"
            />
          </div>

          <div className="space-y-2">
            <p className="text-xs font-medium text-muted-foreground">Merge tags — click to insert at cursor</p>
            <div className="flex flex-wrap gap-1.5">
              {MERGE_TAGS.map((token) => (
                <button
                  key={token}
                  type="button"
                  onClick={() => insertToken(token)}
                  title={`Insert {{${token}}}`}
                  className="px-2 py-0.5 rounded bg-muted text-xs font-mono hover:bg-primary/10 hover:text-primary transition-colors"
                >
                  {`{{${token}}}`}
                </button>
              ))}
            </div>
          </div>

          <div className="space-y-3">
            <Label>Steps</Label>
            {steps.map((step, index) => (
              <Card key={step.key} className="shadow-none">
                <CardContent className="p-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium">Step {index + 1}</span>
                      {index === 0 ? (
                        <span className="text-xs text-muted-foreground">Sends when enrolled</span>
                      ) : (
                        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                          Wait
                          <Input
                            type="number"
                            min={0}
                            value={step.delay_days}
                            onChange={(e) => updateStep(index, { delay_days: Math.max(0, Number(e.target.value)) })}
                            className="h-7 w-16"
                          />
                          days
                        </div>
                      )}
                    </div>
                    <div className="flex items-center gap-1">
                      <Button type="button" variant="ghost" size="icon" className="h-7 w-7" disabled={index === 0} onClick={() => moveStep(index, -1)}>
                        <ChevronUp className="h-3.5 w-3.5" />
                      </Button>
                      <Button type="button" variant="ghost" size="icon" className="h-7 w-7" disabled={index === steps.length - 1} onClick={() => moveStep(index, 1)}>
                        <ChevronDown className="h-3.5 w-3.5" />
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 text-destructive"
                        disabled={steps.length === 1}
                        onClick={() => removeStep(index)}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  </div>

                  <div className="space-y-1.5">
                    <Label className="text-xs text-muted-foreground">Subject</Label>
                    <Input
                      ref={(el) => {
                        subjectRefs.current[index] = el;
                      }}
                      value={step.subject_template}
                      onChange={(e) => updateStep(index, { subject_template: e.target.value })}
                      onFocus={() => setLastFocused({ index, field: "subject" })}
                      placeholder="Quick question, {{first_name}}?"
                    />
                  </div>

                  <div className="space-y-1.5" onFocusCapture={() => setLastFocused({ index, field: "body" })}>
                    <Label className="text-xs text-muted-foreground">Body</Label>
                    <TipTapEditor
                      ref={(el) => {
                        bodyRefs.current[index] = el;
                      }}
                      value={step.body_template}
                      onChange={(html) => updateStep(index, { body_template: html })}
                      minHeight={140}
                    />
                  </div>

                  <div className="space-y-2 pt-1 border-t">
                    <div className="flex items-center gap-2 pt-2">
                      <Checkbox
                        id={`auto-ai-${step.key}`}
                        checked={step.draft_source === "ai"}
                        onCheckedChange={(checked) => updateStep(index, { draft_source: checked === true ? "ai" : "template" })}
                      />
                      <Label htmlFor={`auto-ai-${step.key}`} className="text-xs font-normal text-muted-foreground cursor-pointer">
                        Auto-draft with AI at fire time (default: use the template above)
                      </Label>
                    </div>
                    <div className="space-y-1.5">
                      <Label className="text-xs text-muted-foreground">AI instructions (optional)</Label>
                      <Textarea
                        value={step.ai_instructions}
                        onChange={(e) => updateStep(index, { ai_instructions: e.target.value })}
                        placeholder="Guidance for AI drafts of this step — tone, what to mention, what to avoid..."
                        className="min-h-16 text-sm"
                      />
                      <p className="text-xs text-muted-foreground">
                        Used both by the rep&apos;s on-demand &ldquo;Draft with AI&rdquo; button and by auto-draft above. AI
                        drafts are always reviewed by a human before sending — a template stays the fallback.
                      </p>
                    </div>
                  </div>
                </CardContent>
              </Card>
            ))}

            <Button type="button" variant="outline" size="sm" onClick={addStep}>
              <Plus className="h-3.5 w-3.5 mr-1.5" /> Add step
            </Button>
          </div>
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button type="button" onClick={handleSave} disabled={saving}>
            {saving && <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />}
            {isEdit ? "Save changes" : "Create sequence"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
