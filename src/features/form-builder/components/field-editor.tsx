"use client";

import { useState, useEffect } from "react";
import { Plus, Trash2, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetFooter,
} from "@/components/ui/sheet";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Checkbox } from "@/components/ui/checkbox";
import { Separator } from "@/components/ui/separator";
import type { FormField } from "@/types/database";
import { toFieldName } from "../lib/validation";

interface FieldEditorProps {
  field: FormField | null;
  open: boolean;
  onClose: () => void;
  onSave: (field: FormField) => void;
}

const WIDTH_OPTIONS = [
  { value: "full", label: "Full width" },
  { value: "half", label: "Half width" },
  { value: "third", label: "One third" },
  { value: "two-thirds", label: "Two thirds" },
];

export function FieldEditor({ field, open, onClose, onSave }: FieldEditorProps) {
  const [draft, setDraft] = useState<FormField | null>(null);
  const [showAdvanced, setShowAdvanced] = useState(false);

  useEffect(() => {
    if (field) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setDraft({ ...field });
    }
  }, [field]);

  if (!draft) return null;

  function update(patch: Partial<FormField>) {
    setDraft((prev) => prev ? { ...prev, ...patch } : prev);
  }

  function handleLabelChange(label: string) {
    setDraft((prev) => {
      if (!prev) return prev;
      const autoName = toFieldName(label) || prev.name;
      return { ...prev, label, name: autoName };
    });
  }

  function addOption() {
    const d = draft;
    if (!d) return;
    const opts = d.options ?? [];
    update({ options: [...opts, { label: `Option ${opts.length + 1}`, value: `option_${opts.length + 1}` }] });
  }

  function updateOption(index: number, key: "label" | "value", val: string) {
    const d = draft;
    if (!d) return;
    const opts = [...(d.options ?? [])];
    opts[index] = { ...opts[index], [key]: val };
    update({ options: opts });
  }

  function removeOption(index: number) {
    const d = draft;
    if (!d) return;
    update({ options: (d.options ?? []).filter((_, i) => i !== index) });
  }

  function handleSave() {
    const d = draft;
    if (!d || !d.label.trim() || !d.name.trim()) return;
    onSave(d);
    onClose();
  }

  const isOptionField = draft.type === "select" || draft.type === "radio";
  const isFileField = draft.type === "file";

  return (
    <Sheet open={open} onOpenChange={(o) => !o && onClose()}>
      <SheetContent className="w-full sm:max-w-md overflow-y-auto">
        <SheetHeader>
          <SheetTitle>Edit Field</SheetTitle>
        </SheetHeader>

        <div className="space-y-5 py-4">
          {/* Label */}
          <div className="space-y-1.5">
            <Label htmlFor="field-label">Label *</Label>
            <Input
              id="field-label"
              value={draft.label}
              onChange={(e) => handleLabelChange(e.target.value)}
              placeholder="e.g. First Name"
            />
          </div>

          {/* Type */}
          <div className="space-y-1.5">
            <Label>Field Type</Label>
            <Select
              value={draft.type}
              onValueChange={(val) => update({ type: val as FormField["type"] })}
            >
              <SelectTrigger>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="text">Text</SelectItem>
                <SelectItem value="email">Email</SelectItem>
                <SelectItem value="tel">Phone</SelectItem>
                <SelectItem value="number">Number</SelectItem>
                <SelectItem value="date">Date</SelectItem>
                <SelectItem value="textarea">Textarea</SelectItem>
                <SelectItem value="select">Dropdown (Select)</SelectItem>
                <SelectItem value="radio">Radio</SelectItem>
                <SelectItem value="checkbox">Checkbox</SelectItem>
                <SelectItem value="file">File Upload</SelectItem>
                <SelectItem value="entity_select">Entity Select</SelectItem>
              </SelectContent>
            </Select>
          </div>

          {/* Required */}
          <div className="flex items-center gap-2">
            <Checkbox
              id="field-required"
              checked={draft.required}
              onCheckedChange={(checked) => update({ required: checked === true })}
            />
            <Label htmlFor="field-required" className="cursor-pointer">Required field</Label>
          </div>

          {/* Advanced settings toggle */}
          <button
            type="button"
            className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
            onClick={() => setShowAdvanced(!showAdvanced)}
          >
            <ChevronRight className={`h-3.5 w-3.5 transition-transform ${showAdvanced ? "rotate-90" : ""}`} />
            Advanced settings
          </button>

          {showAdvanced && (
            <>
              {/* Name (field key) */}
              <div className="space-y-1.5">
                <Label htmlFor="field-name">Field Name (key)</Label>
                <Input
                  id="field-name"
                  value={draft.name}
                  onChange={(e) => update({ name: toFieldName(e.target.value) || e.target.value })}
                  placeholder="e.g. first_name"
                />
                <p className="text-xs text-muted-foreground">Lowercase letters and underscores only</p>
              </div>

              {/* Placeholder */}
              {draft.type !== "checkbox" && draft.type !== "file" && draft.type !== "entity_select" && (
                <div className="space-y-1.5">
                  <Label htmlFor="field-placeholder">Placeholder</Label>
                  <Input
                    id="field-placeholder"
                    value={draft.placeholder ?? ""}
                    onChange={(e) => update({ placeholder: e.target.value })}
                    placeholder="Optional placeholder text"
                  />
                </div>
              )}

              {/* Width */}
              <div className="space-y-1.5">
                <Label>Width</Label>
                <Select
                  value={draft.width ?? "full"}
                  onValueChange={(val) => update({ width: val as FormField["width"] })}
                >
                  <SelectTrigger>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {WIDTH_OPTIONS.map((o) => (
                      <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </>
          )}

          {/* Options for select/radio */}
          {isOptionField && (
            <>
              <Separator />
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <Label>Options</Label>
                  <Button variant="outline" size="sm" onClick={addOption}>
                    <Plus className="h-3.5 w-3.5 mr-1" /> Add
                  </Button>
                </div>
                <div className="space-y-2">
                  {(draft.options ?? []).map((opt, i) => (
                    <div key={i} className="flex gap-2 items-center">
                      <Input
                        value={opt.label}
                        onChange={(e) => updateOption(i, "label", e.target.value)}
                        placeholder="Label"
                        className="flex-1"
                      />
                      <Input
                        value={opt.value}
                        onChange={(e) => updateOption(i, "value", e.target.value)}
                        placeholder="Value"
                        className="flex-1 font-mono text-xs"
                      />
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-8 w-8 text-destructive shrink-0"
                        onClick={() => removeOption(i)}
                      >
                        <Trash2 className="h-3.5 w-3.5" />
                      </Button>
                    </div>
                  ))}
                </div>
              </div>
            </>
          )}

          {/* File validation (advanced) */}
          {showAdvanced && isFileField && (
            <>
              <Separator />
              <div className="space-y-3">
                <Label>File Validation</Label>
                <div className="space-y-1.5">
                  <Label htmlFor="max-size" className="text-xs text-muted-foreground">Max file size (MB)</Label>
                  <Input
                    id="max-size"
                    type="number"
                    min={1}
                    max={50}
                    value={draft.validation?.max_size_mb ?? 5}
                    onChange={(e) =>
                      update({ validation: { ...draft.validation, max_size_mb: Number(e.target.value) } })
                    }
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="accepted-types" className="text-xs text-muted-foreground">Accepted file types</Label>
                  <Input
                    id="accepted-types"
                    value={(draft.validation?.accepted_types ?? []).join(", ")}
                    onChange={(e) =>
                      update({
                        validation: {
                          ...draft.validation,
                          accepted_types: e.target.value
                            .split(",")
                            .map((t) => t.trim())
                            .filter(Boolean),
                        },
                      })
                    }
                    placeholder=".pdf, .doc, .jpg"
                  />
                  <p className="text-xs text-muted-foreground">Comma-separated extensions</p>
                </div>
              </div>
            </>
          )}

          {/* Number validation (advanced) */}
          {showAdvanced && draft.type === "number" && (
            <>
              <Separator />
              <div className="space-y-3">
                <Label>Number Validation</Label>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <Label htmlFor="num-min" className="text-xs text-muted-foreground">Min value</Label>
                    <Input
                      id="num-min"
                      type="number"
                      value={draft.validation?.min ?? ""}
                      onChange={(e) =>
                        update({
                          validation: {
                            ...draft.validation,
                            min: e.target.value ? Number(e.target.value) : undefined,
                          },
                        })
                      }
                      placeholder="No min"
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="num-max" className="text-xs text-muted-foreground">Max value</Label>
                    <Input
                      id="num-max"
                      type="number"
                      value={draft.validation?.max ?? ""}
                      onChange={(e) =>
                        update({
                          validation: {
                            ...draft.validation,
                            max: e.target.value ? Number(e.target.value) : undefined,
                          },
                        })
                      }
                      placeholder="No max"
                    />
                  </div>
                </div>
              </div>
            </>
          )}

          {/* Date validation (advanced) */}
          {showAdvanced && draft.type === "date" && (
            <>
              <Separator />
              <div className="space-y-3">
                <Label>Date Validation</Label>
                <div className="grid grid-cols-2 gap-3">
                  <div className="space-y-1.5">
                    <Label htmlFor="date-min" className="text-xs text-muted-foreground">Earliest date</Label>
                    <Input
                      id="date-min"
                      type="date"
                      value={draft.validation?.min_date ?? ""}
                      onChange={(e) =>
                        update({
                          validation: {
                            ...draft.validation,
                            min_date: e.target.value || undefined,
                          },
                        })
                      }
                    />
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="date-max" className="text-xs text-muted-foreground">Latest date</Label>
                    <Input
                      id="date-max"
                      type="date"
                      value={draft.validation?.max_date ?? ""}
                      onChange={(e) =>
                        update({
                          validation: {
                            ...draft.validation,
                            max_date: e.target.value || undefined,
                          },
                        })
                      }
                    />
                  </div>
                </div>
              </div>
            </>
          )}

          {/* Terms URL for checkbox (advanced) */}
          {showAdvanced && draft.type === "checkbox" && (
            <div className="space-y-1.5">
              <Label htmlFor="terms-url">Terms URL (optional)</Label>
              <Input
                id="terms-url"
                value={draft.terms_url ?? ""}
                onChange={(e) => update({ terms_url: e.target.value })}
                placeholder="https://example.com/terms"
              />
            </div>
          )}
        </div>

        <SheetFooter>
          <Button variant="outline" onClick={onClose}>Cancel</Button>
          <Button onClick={handleSave} disabled={!draft.label.trim()}>Save Field</Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
