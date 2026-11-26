"use client";

import { createContext, useContext, useState } from "react";
import { CaretDownIcon } from "@/components/icons";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PhoneInput } from "@/components/ui/phone-input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

/**
 * Shared layout building blocks for the Student Details dialog's sections
 * (Personal Information, Study Interest, Academic Information, and whatever
 * follows) — kept in one place so every section looks and behaves the same
 * instead of each one reinventing its own card/grid/field styling.
 */

const CollapsibleGroupsContext = createContext(false);

/**
 * Edit profile (EDGEX-155) layout: sentence-case labels ("Date of birth"), "Set …" placeholders and two-column grids inside the
 * 600px section panel. Off everywhere else, so the classic pop-up and the summary card render exactly as before.
 */
export const EditProfileLayoutContext = createContext(false);

/** "Date of Birth" → "Date of birth"; words that are already all caps (GPA, IELTS, SEE, +2) are kept. */
export function sentenceCase(label: string): string {
  const words = label.split(" ");
  return words.map((w, i) => (/^[A-Z0-9+/&-]{2,}$/.test(w) ? w : i === 0 ? w.charAt(0).toUpperCase() + w.slice(1).toLowerCase() : w.toLowerCase())).join(" ");
}

/**
 * Wrap a region to make every SectionGroup inside it collapsible (open by default) —
 * including groups added to that region later, with nothing to remember per section.
 * Outside a <CollapsibleGroups>, a SectionGroup is a plain heading (e.g. in the dialog).
 */
export function CollapsibleGroups({ children }: { children: React.ReactNode }) {
  return <CollapsibleGroupsContext.Provider value={true}>{children}</CollapsibleGroupsContext.Provider>;
}

/** A small field label that follows Edit profile's sentence case; everywhere else it is a plain `<p>`. */
export function FieldLabel({ className, children }: { className?: string; children: string }) {
  const compact = useContext(EditProfileLayoutContext);
  return <p className={className}>{compact ? sentenceCase(children) : children}</p>;
}

/** "Set <label>" placeholder inside Edit profile; `undefined` elsewhere (those inputs keep whatever they had). */
export function useSetPlaceholder(): (label: string) => string | undefined {
  const compact = useContext(EditProfileLayoutContext);
  return (label) => (compact ? `Set ${sentenceCase(label).toLowerCase()}` : undefined);
}

export function SectionGroup({ title, children }: { title: string; children: React.ReactNode }) {
  const collapsible = useContext(CollapsibleGroupsContext);
  const [open, setOpen] = useState(true);
  const isOpen = !collapsible || open;

  return (
    <div className="space-y-3">
      <h3 className="text-sm font-semibold text-foreground">
        {collapsible ? (
          <button
            type="button"
            aria-expanded={isOpen}
            onClick={() => setOpen(!open)}
            className="flex w-full items-center justify-between gap-2 text-left"
          >
            {title}
            <CaretDownIcon
              aria-hidden="true"
              className={cn(
                "h-4 w-4 shrink-0 text-muted-foreground transition-transform duration-200",
                isOpen && "rotate-180"
              )}
            />
          </button>
        ) : (
          title
        )}
      </h3>
      {isOpen && children}
    </div>
  );
}

export function CardSection({
  title,
  action,
  children,
}: {
  title?: string;
  /** Optional header-row control, e.g. an "Attach Document" button — rendered right-aligned next to the title. */
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-lg border bg-card">
      {(title || action) && (
        <div className="flex items-center justify-between px-4 pt-3 pb-2 border-b">
          {title && <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{title}</h4>}
          {action}
        </div>
      )}
      <div className="p-4">{children}</div>
    </div>
  );
}

export function FieldGrid({ children, columns: requested = 3 }: { children: React.ReactNode; columns?: 2 | 3 }) {
  const compact = useContext(EditProfileLayoutContext);
  const columns = compact ? 2 : requested;
  const cols = columns === 2 ? "grid-cols-1 sm:grid-cols-2" : "grid-cols-1 sm:grid-cols-2 lg:grid-cols-3";
  return <div className={`grid ${cols} gap-x-6 gap-y-4`}>{children}</div>;
}

export function ReadOnlyField({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs text-muted-foreground mb-1">{label}</p>
      <p className="text-sm font-medium">{value}</p>
    </div>
  );
}

export interface FieldDef {
  key: string;
  label: string;
  type: string;
  placeholder?: string;
  span?: 1 | 2;
  /** Required when type === "select" — the field's own options, e.g. Marital Status vs. a future field's own list. */
  options?: readonly { value: string; label: string }[];
}

/** Reserved dropdown value for the "+ Add new option…" row (never stored). */
const ADD_OPTION_VALUE = "__add_option__";

export function EditableField({
  field,
  isEditing,
  value,
  onChange,
  readOnlyNote,
  disabled,
  invalid,
  needed,
  onAddOption,
  onBlur,
  warning,
}: {
  field: FieldDef;
  isEditing: boolean;
  value: string;
  onChange: (value: string) => void;
  /** Shows the value but locks it, with this note beneath (a field that is derived from another one). */
  readOnlyNote?: string;
  /** Greys a dropdown out until the field it depends on is chosen (e.g. District before Province). */
  disabled?: boolean;
  /** Marks the field red — it is still required before the lead can move to Applications. */
  invalid?: boolean;
  /** Edit profile: the consent form still needs this value ("· needed for consent" after the label). */
  needed?: boolean;
  /**
   * A dropdown only: adds a "+ Add new option…" row. Saves the new option and resolves with its stored value (it is then picked),
   * or null when it could not be saved. Leave undefined and the dropdown is exactly as before.
   */
  onAddOption?: (label: string) => Promise<string | null>;
  /** A text box only: called when the person leaves the box. */
  onBlur?: () => void;
  /** A heads-up shown under the box while editing (amber). It never blocks anything. */
  warning?: string | null;
}) {
  const compact = useContext(EditProfileLayoutContext);
  const [adding, setAdding] = useState(false);
  const [newLabel, setNewLabel] = useState("");
  const [savingNew, setSavingNew] = useState(false);
  const submitNew = async () => {
    const label = newLabel.trim();
    if (!onAddOption || !label || savingNew) return;
    setSavingNew(true);
    const picked = await onAddOption(label);
    setSavingNew(false);
    if (picked) {
      onChange(picked);
      setAdding(false);
      setNewLabel("");
    }
  };
  const label = compact ? sentenceCase(field.label) : field.label;
  const redBorder = invalid ? "border-red-500 focus-visible:ring-red-500" : "";
  return (
    <div className={field.span === 2 ? "col-span-full" : undefined} data-invalid={invalid ? "true" : undefined}>
      <p className={invalid ? "text-xs font-medium text-red-600 mb-1" : "text-xs text-muted-foreground mb-1"}>
        {label}
        {invalid ? " — required" : ""}
        {needed && !invalid && <span className="font-normal text-[#b25e09]"> · needed for consent</span>}
      </p>
      {isEditing ? (
        field.type === "select" ? (
          <>
          <Select
            value={value || "__none__"}
            onValueChange={(v) => {
              if (v === ADD_OPTION_VALUE) { setAdding(true); return; }
              onChange(v === "__none__" ? "" : v);
            }}
            disabled={disabled}
          >
            <SelectTrigger className={`h-9 text-sm w-full ${redBorder}`}>
              <SelectValue placeholder="Select" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="__none__"><span className="text-muted-foreground">Select</span></SelectItem>
              {(field.options ?? []).map((opt) => (
                <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
              ))}
              {/* A value saved before this was a list (old free text) must stay visible, not vanish. */}
              {value && !field.options?.some((opt) => opt.value === value) && (
                <SelectItem value={value}>{value}</SelectItem>
              )}
              {onAddOption && <SelectItem value={ADD_OPTION_VALUE}>+ Add new option…</SelectItem>}
            </SelectContent>
          </Select>
          {onAddOption && adding && (
            <div className="mt-2 flex items-center gap-2">
              <Input
                value={newLabel}
                onChange={(e) => setNewLabel(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") { e.preventDefault(); e.stopPropagation(); void submitNew(); }
                }}
                placeholder="New option name"
                maxLength={60}
                autoFocus
                className="h-9 text-sm"
                aria-label={`New ${field.label.toLowerCase()} option`}
              />
              <Button type="button" size="sm" disabled={!newLabel.trim() || savingNew} onClick={() => void submitNew()}>Add</Button>
              <Button type="button" size="sm" variant="ghost" disabled={savingNew} onClick={() => { setAdding(false); setNewLabel(""); }}>Cancel</Button>
            </div>
          )}
          </>
        ) : field.type === "tel" ? (
          // Same country-code dropdown + number box the forms use; stored as "+977-98…".
          <div className={invalid ? "rounded-md ring-1 ring-red-500" : undefined}>
            <PhoneInput value={value} onChange={onChange} placeholder={field.placeholder ?? "Phone number"} disabled={disabled} />
          </div>
        ) : (
          <>
            <Label htmlFor={field.key} className="sr-only">{label}</Label>
            <Input
              id={field.key}
              type={field.type}
              value={value}
              onChange={(e) => onChange(e.target.value)}
              onBlur={onBlur}
              placeholder={compact ? `Set ${label.toLowerCase()}` : field.placeholder ?? `Enter ${field.label.toLowerCase()}`}
              className={`h-9 text-sm ${redBorder}`}
              readOnly={!!readOnlyNote}
              disabled={!!readOnlyNote || !!disabled}
            />
            {readOnlyNote && <p className="mt-1 text-xs text-muted-foreground">{readOnlyNote}</p>}
            {warning && <p role="status" className="mt-1 text-xs font-medium text-[#b25e09]">{warning}</p>}
          </>
        )
      ) : (
        <p className="text-sm font-medium">
          {value
            ? (field.options?.find((opt) => opt.value === value)?.label ?? value)
            : <span className="text-muted-foreground">—</span>}
        </p>
      )}
    </div>
  );
}
