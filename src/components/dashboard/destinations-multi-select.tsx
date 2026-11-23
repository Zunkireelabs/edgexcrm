"use client";

import { useId } from "react";
import { SearchableSelect } from "@/components/ui/searchable-select";
import { Label } from "@/components/ui/label";
import { canonicalizeDestinations } from "@/lib/leads/destination-normalize";

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
  label = "Interested destination",
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
  //
  // It ALSO re-spells every value the catalog knows in the CATALOG's spelling (case/whitespace-insensitive): a lead
  // saved with "uk" shows UK ticked, and saving writes "UK" back (stage #682, client report Nov 2026).
  const cleanSelected = canonicalizeDestinations(selected, options);
  // Selected values the catalog has no entry for (a destination since removed from Settings, or free text from a form)
  // still get an option, so they can always be unticked.
  const extraSelected = cleanSelected.filter((v) => !options.includes(v));

  const instanceId = useId();
  return (
    <div className="space-y-1.5">
      <Label htmlFor={`${instanceId}-trigger`} className="text-xs text-gray-600">
        {optional ? `${label} (optional)` : label}
      </Label>
      {/* EDGEX-145: one shared searchable multi-select (was a checkbox grid). Same values, same onChange. */}
      <SearchableSelect
        multiple
        id={`${instanceId}-trigger`}
        options={[...options, ...extraSelected].map((dest) => ({ value: dest, label: dest }))}
        value={cleanSelected}
        onValueChange={(next) => onChange(canonicalizeDestinations(next, options))}
        placeholder="Select destinations"
        searchPlaceholder="Search destinations…"
        disabled={disabled}
      />
    </div>
  );
}
