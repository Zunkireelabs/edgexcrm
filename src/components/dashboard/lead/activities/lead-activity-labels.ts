import { INTAKE_SOURCES } from "@/industries/_shared/features/lead-lists/taxonomies";

// Intake values are stored as slugs (manual_entry, dashboard, check_in); show them as labels.
export function humanizeIntakeValue(value: string | null | undefined): string {
  if (!value) return "";
  const known = INTAKE_SOURCES.find((s) => s.value === value);
  if (known) return known.label;
  const words = value.replace(/_/g, " ");
  return words.charAt(0).toUpperCase() + words.slice(1);
}

// Wording of a `lead.submission` timeline entry. `created_via: "manual"` marks a
// lead a staff member added from the dashboard (not a form fill).
export function describeSubmission(changes: {
  is_first?: { new?: unknown };
  form_name?: { new?: unknown };
  created_via?: { new?: unknown };
}): string {
  const isFirst = changes.is_first?.new === true;
  const formName = (changes.form_name?.new as string | null | undefined) ?? null;
  if (changes.created_via?.new === "manual") {
    return isFirst ? "Lead created manually" : "Lead details added again manually";
  }
  return isFirst
    ? `Lead created${formName ? ` · Filled ${formName}` : ""}`
    : `Filled ${formName || "form"}`;
}
