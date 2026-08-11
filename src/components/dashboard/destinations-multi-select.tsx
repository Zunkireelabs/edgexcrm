"use client";

import { useId, useState } from "react";
import { ChevronDown } from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import { normalizeDestinations } from "@/lib/leads/destination-normalize";

// Shared by every "Interested Destination(s)" picker across the CRM (Add Lead,
// lead detail Study Interest panel, lead Qualify dialog, leads-table Qualify
// row action, check-in walk-in form, Application create/edit sheets) — was
// previously copy-pasted independently into each. Options come from
// useEduTaxonomy().destinations, which reads the tenant-configurable list at
// Settings > Organization > Destination Countries.
export function DestinationsMultiSelect({
  selected,
  onChange,
  disabled,
  options,
  label = "Interested Destination",
  optional = true,
}: {
  selected: string[];
  onChange: (next: string[]) => void;
  disabled?: boolean;
  options: string[];
  label?: string;
  optional?: boolean;
}) {
  // Every caller seeds `selected` from lead data of varying cleanliness — an older
  // submission can carry a flag emoji or off-canon casing for the same country the
  // lead's current column already stores cleanly, producing two different strings
  // that both mean "USA" in the same array. Normalizing/deduping once here, at the
  // single shared render point, guarantees one destination = one entry no matter
  // which of the 6+ callers passed in the dirty array — a checkbox for an
  // already-present destination always shows checked, so it can never be added a
  // second time through this picker.
  const cleanSelected = normalizeDestinations(selected);

  // Toggle membership lives here, not in each caller — this is the one place
  // that logic should exist now that rendering is already centralized. Operates
  // on cleanSelected (not the raw prop) so toggling also silently repairs a
  // dirty selection the moment the user interacts with it.
  function toggle(dest: string) {
    onChange(cleanSelected.includes(dest) ? cleanSelected.filter((d) => d !== dest) : [...cleanSelected, dest]);
  }
  const [open, setOpen] = useState(false);
  // Unique per mounted instance — prevents duplicate DOM ids (and the
  // mislabeled-checkbox bug that causes) when two of these are open at once
  // (e.g. a lead's Study Interest panel left in edit mode behind its Qualify dialog).
  const instanceId = useId();
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
        <span className={cleanSelected.length === 0 ? "text-muted-foreground" : ""}>
          {cleanSelected.length === 0 ? "Select destinations" : cleanSelected.join(", ")}
        </span>
        <ChevronDown className={`h-4 w-4 text-muted-foreground transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      {open && (
        <div className="border border-input rounded-md p-2 grid grid-cols-2 gap-1.5 bg-background shadow-sm">
          {options.map((dest) => (
            <div key={dest} className="flex items-center gap-2">
              <Checkbox
                id={`${instanceId}-${dest}`}
                checked={cleanSelected.includes(dest)}
                disabled={disabled}
                onCheckedChange={() => toggle(dest)}
              />
              <label htmlFor={`${instanceId}-${dest}`} className="text-xs cursor-pointer select-none">
                {dest}
              </label>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
