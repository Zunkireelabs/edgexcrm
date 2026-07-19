"use client";

import { useState } from "react";
import { ChevronDown } from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";

// Shared by every "Interested Destination(s)" picker across the CRM (Add Lead,
// lead detail Study Interest panel, lead Qualify dialog, leads-table Qualify
// row action, check-in walk-in form, Application create/edit sheets) — was
// previously copy-pasted independently into each. Options come from
// useEduTaxonomy().destinations, which reads the tenant-configurable list at
// Settings > Organization > Destination Countries.
export function DestinationsMultiSelect({
  selected,
  onToggle,
  disabled,
  options,
  label = "Interested Destination",
  optional = true,
}: {
  selected: string[];
  onToggle: (dest: string) => void;
  disabled?: boolean;
  options: string[];
  label?: string;
  optional?: boolean;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="space-y-1.5">
      <Label className="text-xs text-gray-600">
        {label}
        {optional && <span className="ml-1 text-gray-400">(optional)</span>}
      </Label>
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen((v) => !v)}
        className="w-full flex items-center justify-between px-3 py-2 border border-input rounded-md text-sm bg-background hover:bg-accent transition-colors"
      >
        <span className={selected.length === 0 ? "text-muted-foreground" : ""}>
          {selected.length === 0 ? "Select destinations" : selected.join(", ")}
        </span>
        <ChevronDown className={`h-4 w-4 text-muted-foreground transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      {open && (
        <div className="border border-input rounded-md p-2 grid grid-cols-2 gap-1.5 bg-background shadow-sm">
          {options.map((dest) => (
            <div key={dest} className="flex items-center gap-2">
              <Checkbox
                id={`dest-${dest}`}
                checked={selected.includes(dest)}
                disabled={disabled}
                onCheckedChange={() => onToggle(dest)}
              />
              <label htmlFor={`dest-${dest}`} className="text-xs cursor-pointer select-none">
                {dest}
              </label>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
