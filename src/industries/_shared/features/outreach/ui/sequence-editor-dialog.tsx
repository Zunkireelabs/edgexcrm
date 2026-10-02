"use client";

import { useState, useRef, useEffect } from "react";
import { Plus, Trash2, ChevronUp, ChevronDown, Loader2, Eye, Monitor, Smartphone } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
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
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Card, CardContent } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "sonner";
import { TipTapEditor, type TipTapEditorHandle } from "@/industries/_shared/features/email/components/tiptap-editor";
import { HtmlSourceEditor, type HtmlSourceEditorHandle } from "@/industries/_shared/features/email/components/html-source-editor";
import type { Sequence } from "../hooks/use-sequences";
import { detectBodyMode, fillSampleMergeTags, type StepBodyMode } from "../lib/body-format";

// Same height for the editor and the inline preview in both modes, so switching never makes the box jump.
const BODY_HEIGHT = 420;

const MERGE_TAGS = ["first_name", "last_name", "email", "phone", "city", "country", "tenant_name"];

interface StepDraft {
  key: string;
  delay_days: number;
  subject_template: string;
  body_template: string;
  /** Editor mode only (not saved): "rich" = TipTap, "html" = source + preview. Inferred from the body on load. */
  mode: StepBodyMode;
  draft_source: "template" | "ai";
  ai_instructions: string;
}

interface SequenceEditorDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  sequence: Sequence | null;
  /** `saved` is the sequence that was just created or edited — callers use `created` to offer "who should get it?". */
  onSaved: (saved?: { id: string; name: string; created: boolean }) => void;
  industryId: string | null;
}

let keyCounter = 0;
function newKey() {
  keyCounter += 1;
  return `step-${keyCounter}`;
}

function stepsFromSequence(sequence: Sequence | null): StepDraft[] {
  if (!sequence) {
    return [{ key: newKey(), delay_days: 0, subject_template: "", body_template: "", mode: "rich", draft_source: "template", ai_instructions: "" }];
  }
  return [...sequence.email_sequence_steps]
    .sort((a, b) => a.step_order - b.step_order)
    .map((s) => ({
      key: newKey(),
      delay_days: s.delay_days,
      subject_template: s.subject_template,
      body_template: s.body_template,
      mode: detectBodyMode(s.body_template),
      draft_source: s.draft_source ?? "template",
      ai_instructions: s.ai_instructions ?? "",
    }));
}

export function SequenceEditorDialog({ open, onOpenChange, sequence, onSaved, industryId }: SequenceEditorDialogProps) {
  // OUTREACH-PHASE2-BRIEF.md §6 — building this only for education_consultancy's
  // manifest registration already keeps it out of it_agency's reach, but gate
  // the toggle in the component itself too, per CLAUDE.md's industry-aware UI
  // convention, in case this same component is ever reused elsewhere.
  const canAutoSend = industryId === "education_consultancy";
  const isEdit = !!sequence;
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [autoSend, setAutoSend] = useState(false);
  const [onReply, setOnReply] = useState<"pause" | "end" | "continue">("pause");
  const [steps, setSteps] = useState<StepDraft[]>([]);
  const [saving, setSaving] = useState(false);
  const [previewIndex, setPreviewIndex] = useState<number | null>(null);
  const [previewDevice, setPreviewDevice] = useState<"desktop" | "mobile">("desktop");
  const [pendingRichIndex, setPendingRichIndex] = useState<number | null>(null);
  const [lastFocused, setLastFocused] = useState<{ index: number; field: "subject" | "body" } | null>(null);

  const subjectRefs = useRef<Record<number, HTMLInputElement | null>>({});
  const bodyRefs = useRef<Record<number, TipTapEditorHandle | HtmlSourceEditorHandle | null>>({});

  useEffect(() => {
    if (open) {
      setName(sequence?.name ?? "");
      setDescription(sequence?.description ?? "");
      setAutoSend(sequence?.auto_send ?? false);
      setOnReply(sequence?.on_reply ?? "pause");
      setSteps(stepsFromSequence(sequence));
      setLastFocused(null);
      setPreviewIndex(null);
      setPendingRichIndex(null);
    }
  }, [open, sequence]);

  const updateStep = (index: number, patch: Partial<StepDraft>) => {
    setSteps((prev) => prev.map((s, i) => (i === index ? { ...s, ...patch } : s)));
  };

  const addStep = () => {
    setSteps((prev) => [
      ...prev,
      { key: newKey(), delay_days: 3, subject_template: "", body_template: "", mode: "rich", draft_source: "template", ai_instructions: "" },
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

  // Rich text -> HTML is lossless (same HTML string). HTML -> Rich text can drop tables/styles,
  // so confirm first when the body actually carries designed markup.
  const switchMode = (index: number, mode: StepBodyMode) => {
    const step = steps[index];
    if (!step || step.mode === mode) return;
    if (mode === "rich" && detectBodyMode(step.body_template) === "html") {
      setPendingRichIndex(index);
      return;
    }
    updateStep(index, { mode });
  };

  const fullPreviewButton = (index: number) => (
    <Button type="button" variant="outline" size="sm" className="h-8 px-3 text-xs" onClick={() => setPreviewIndex(index)}>
      <Eye className="h-3.5 w-3.5 mr-1.5" /> Full preview
    </Button>
  );

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
      auto_send: autoSend,
      on_reply: onReply,
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
      const savedRow = json?.data as { id?: string; name?: string } | undefined;
      onSaved(savedRow?.id ? { id: savedRow.id, name: savedRow.name ?? "", created: !isEdit } : undefined);
      onOpenChange(false);
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-4xl max-h-[90vh] flex flex-col">
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

          {canAutoSend && (
            <div className="flex items-start gap-2 rounded-md border p-3">
              <Checkbox id="seq-auto-send" checked={autoSend} onCheckedChange={(checked) => setAutoSend(checked === true)} />
              <div className="space-y-0.5">
                <Label htmlFor="seq-auto-send" className="text-sm font-normal cursor-pointer">
                  Auto-send — every step sends automatically via EdgeX
                </Label>
                <p className="text-xs text-muted-foreground">
                  No per-step review. Once a lead is enrolled, each step sends itself when due — the
                  timeline below stays as an audit trail, not an inbox to work through.
                </p>
              </div>
            </div>
          )}

          <div className="space-y-1.5 rounded-md border p-3">
            <Label htmlFor="seq-on-reply" className="text-sm font-normal">
              When a lead replies
            </Label>
            <Select value={onReply} onValueChange={(v) => setOnReply(v as "pause" | "end" | "continue")}>
              <SelectTrigger id="seq-on-reply" className="h-8 w-full sm:w-72">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="pause">Pause the sequence (recommended)</SelectItem>
                <SelectItem value="end">End the sequence</SelectItem>
                <SelectItem value="continue">Keep sending</SelectItem>
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">
              Out-of-office and other automatic replies are ignored. A paused lead sends nothing until you resume
              it from the lead&apos;s page or the Enrollments tab.
            </p>
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
                    <div className="flex items-center justify-between">
                      <Label className="text-xs text-muted-foreground">Body</Label>
                      <div className="flex items-center gap-1">
                        <div className="inline-flex rounded-md border p-0.5" role="group" aria-label="Body editor mode">
                          {(["rich", "html"] as const).map((m) => (
                            <button
                              key={m}
                              type="button"
                              aria-pressed={step.mode === m}
                              onClick={() => switchMode(index, m)}
                              className={`px-2 py-0.5 text-xs rounded transition-colors ${
                                step.mode === m ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted"
                              }`}
                            >
                              {m === "rich" ? "Rich text" : "HTML"}
                            </button>
                          ))}
                        </div>
                      </div>
                    </div>
                    {step.mode === "rich" ? (
                      <Tabs defaultValue="edit" className="gap-2" key={`${step.key}-rich`}>
                        <div className="flex items-center justify-between gap-2">
                          <TabsList className="h-8">
                            <TabsTrigger value="edit" className="text-xs">
                              Edit
                            </TabsTrigger>
                            <TabsTrigger value="preview" className="text-xs">
                              Preview
                            </TabsTrigger>
                          </TabsList>
                          {fullPreviewButton(index)}
                        </div>
                        {/* forceMount keeps the editor (and its insertText ref) alive while Preview is showing. */}
                        <TabsContent value="edit" className="mt-0 data-[state=inactive]:hidden" forceMount>
                          <TipTapEditor
                            ref={(el) => {
                              bodyRefs.current[index] = el;
                            }}
                            value={step.body_template}
                            onChange={(html) => updateStep(index, { body_template: html })}
                            minHeight={BODY_HEIGHT}
                          />
                        </TabsContent>
                        <TabsContent value="preview" className="mt-0 data-[state=inactive]:hidden" forceMount>
                          <div className="border border-input rounded-md overflow-hidden bg-white" style={{ minHeight: BODY_HEIGHT }}>
                            {step.body_template ? (
                              <iframe
                                sandbox=""
                                srcDoc={fillSampleMergeTags(step.body_template)}
                                title="Email preview"
                                className="w-full border-0"
                                style={{ height: BODY_HEIGHT }}
                              />
                            ) : (
                              <div className="flex items-center justify-center text-sm text-muted-foreground" style={{ minHeight: BODY_HEIGHT }}>
                                Nothing to preview yet
                              </div>
                            )}
                          </div>
                          <p className="text-xs text-muted-foreground mt-1.5">
                            Sample data (Jane Doe). Structural preview only — real inboxes may render some CSS differently.
                          </p>
                        </TabsContent>
                      </Tabs>
                    ) : (
                      <HtmlSourceEditor
                        key={`${step.key}-html`}
                        ref={(el) => {
                          bodyRefs.current[index] = el;
                        }}
                        value={step.body_template}
                        onChange={(html) => updateStep(index, { body_template: html })}
                        format="html"
                        onFormatChange={() => {}}
                        showFormatToggle={false}
                        minHeight={BODY_HEIGHT}
                        previewHeight={BODY_HEIGHT}
                        codeTools
                        tabsExtra={fullPreviewButton(index)}
                        placeholder="Paste or write the email HTML here, or drop a .html file — merge tags like {{first_name}} work."
                        previewTransform={fillSampleMergeTags}
                        hideTestEmailHint
                      />
                    )}
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

      <Dialog open={previewIndex !== null} onOpenChange={(o) => !o && setPreviewIndex(null)}>
        <DialogContent className="flex h-[92vh] w-[96vw] max-w-none flex-col gap-3 sm:max-w-6xl">
          <DialogHeader>
            <div className="flex items-center justify-between gap-3 pr-8">
              <DialogTitle>Full preview — Step {(previewIndex ?? 0) + 1}</DialogTitle>
              <div className="inline-flex rounded-md border p-0.5" role="group" aria-label="Preview width">
                {(
                  [
                    ["desktop", "Desktop", Monitor],
                    ["mobile", "Mobile", Smartphone],
                  ] as const
                ).map(([key, label, Icon]) => (
                  <button
                    key={key}
                    type="button"
                    aria-pressed={previewDevice === key}
                    onClick={() => setPreviewDevice(key)}
                    className={`flex items-center gap-1 px-2 py-0.5 text-xs rounded transition-colors ${
                      previewDevice === key ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted"
                    }`}
                  >
                    <Icon className="h-3 w-3" /> {label}
                  </button>
                ))}
              </div>
            </div>
          </DialogHeader>
          {previewIndex !== null && steps[previewIndex] && (
            <div className="flex min-h-0 flex-1 flex-col gap-2">
              <p className="text-sm font-medium break-words">
                <span className="text-muted-foreground font-normal">Subject: </span>
                {fillSampleMergeTags(steps[previewIndex].subject_template) || "—"}
              </p>
              <div className="min-h-0 flex-1 rounded-lg border bg-neutral-100 p-4 dark:bg-neutral-900">
                <iframe
                  sandbox=""
                  srcDoc={fillSampleMergeTags(steps[previewIndex].body_template)}
                  title="Email preview"
                  className={`mx-auto block h-full w-full bg-white shadow-md ${
                    previewDevice === "mobile"
                      ? "max-w-[390px] rounded-2xl border-4 border-neutral-800"
                      : "max-w-[760px] rounded border"
                  }`}
                />
              </div>
              <p className="text-xs text-muted-foreground">
                Sample data (Jane Doe). Structural preview only — Gmail / Outlook / Apple Mail may render some CSS differently.
              </p>
            </div>
          )}
        </DialogContent>
      </Dialog>

      <AlertDialog open={pendingRichIndex !== null} onOpenChange={(o) => !o && setPendingRichIndex(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Switch to Rich text?</AlertDialogTitle>
            <AlertDialogDescription>
              This step contains designed HTML (tables, styles or images). The Rich text editor can&apos;t keep those, so
              editing it there may strip the design. You can stay in HTML mode to keep it exactly as written.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Stay in HTML</AlertDialogCancel>
            <AlertDialogAction
              onClick={() => {
                if (pendingRichIndex !== null) updateStep(pendingRichIndex, { mode: "rich" });
                setPendingRichIndex(null);
              }}
            >
              Switch anyway
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Dialog>
  );
}
