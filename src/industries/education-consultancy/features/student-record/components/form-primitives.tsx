"use client";

import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

/**
 * Shared layout building blocks for the Student Details dialog's sections
 * (Personal Information, Study Interest, Academic Information, and whatever
 * follows) — kept in one place so every section looks and behaves the same
 * instead of each one reinventing its own card/grid/field styling.
 */

export function SectionGroup({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="space-y-3">
      <h3 className="text-sm font-semibold text-foreground">{title}</h3>
      {children}
    </div>
  );
}

export function CardSection({ title, children }: { title?: string; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border bg-card">
      {title && (
        <h4 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground px-4 pt-3 pb-2 border-b">
          {title}
        </h4>
      )}
      <div className="p-4">{children}</div>
    </div>
  );
}

export function FieldGrid({ children }: { children: React.ReactNode }) {
  return <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-x-6 gap-y-4">{children}</div>;
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
}: {
  field: FieldDef;
  isEditing: boolean;
  value: string;
  onChange: (value: string) => void;
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
            </SelectContent>
          </Select>
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
            />
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
