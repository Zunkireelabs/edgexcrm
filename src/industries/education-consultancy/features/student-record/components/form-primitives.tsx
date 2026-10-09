"use client";

import { createContext, useContext, useState } from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
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
 * Wrap a region to make every SectionGroup inside it collapsible (open by default) —
 * including groups added to that region later, with nothing to remember per section.
 * Outside a <CollapsibleGroups>, a SectionGroup is a plain heading (e.g. in the dialog).
 */
export function CollapsibleGroups({ children }: { children: React.ReactNode }) {
  return <CollapsibleGroupsContext.Provider value={true}>{children}</CollapsibleGroupsContext.Provider>;
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
            <ChevronDown
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

export function FieldGrid({ children, columns = 3 }: { children: React.ReactNode; columns?: 2 | 3 }) {
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

export function EditableField({
  field,
  isEditing,
  value,
  onChange,
  readOnlyNote,
}: {
  field: FieldDef;
  isEditing: boolean;
  value: string;
  onChange: (value: string) => void;
  /** Shows the value but locks it, with this note beneath (a field that is derived from another one). */
  readOnlyNote?: string;
}) {
  return (
    <div className={field.span === 2 ? "col-span-full" : undefined}>
      <p className="text-xs text-muted-foreground mb-1">{field.label}</p>
      {isEditing ? (
        field.type === "select" ? (
          <Select value={value || "__none__"} onValueChange={(v) => onChange(v === "__none__" ? "" : v)}>
            <SelectTrigger className="h-9 text-sm w-full">
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
            </SelectContent>
          </Select>
        ) : field.type === "tel" ? (
          // Same country-code dropdown + number box the forms use; stored as "+977-98…".
          <PhoneInput value={value} onChange={onChange} placeholder={field.placeholder ?? "Phone number"} />
        ) : (
          <>
            <Label htmlFor={field.key} className="sr-only">{field.label}</Label>
            <Input
              id={field.key}
              type={field.type}
              value={value}
              onChange={(e) => onChange(e.target.value)}
              placeholder={field.placeholder ?? `Enter ${field.label.toLowerCase()}`}
              className="h-9 text-sm"
              readOnly={!!readOnlyNote}
              disabled={!!readOnlyNote}
            />
            {readOnlyNote && <p className="mt-1 text-xs text-muted-foreground">{readOnlyNote}</p>}
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
