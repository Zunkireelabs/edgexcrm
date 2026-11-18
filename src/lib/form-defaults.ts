import type { FormStep } from "@/types/database";

/**
 * A select's `placeholder` is only grey hint text — it is NOT a value. Some forms
 * (seeded from migration 009) use a country placeholder like "Nepal (NP)" that
 * reads as if Nepal were chosen, while the real form state is empty. The student
 * then submits and gets "Country is required" for a box that looks filled.
 *
 * This makes the placeholder honest: for a country select that a phone field
 * links to via `country_field`, if the placeholder names one of its options
 * (e.g. "Nepal (NP)" -> the "Nepal" option), that option becomes the REAL
 * initial value. State, the phone dial code and the submitted payload then all agree.
 *
 * Only country selects linked from a `tel` field are touched; every other field
 * keeps its normal empty start. A placeholder that doesn't match an option
 * (e.g. "Select country") defaults nothing, so it still behaves as a real prompt.
 */
export function getInitialFormData(
  steps: FormStep[]
): Record<string, string | boolean | number | string[]> {
  const initial: Record<string, string | boolean | number | string[]> = {};

  for (const step of steps) {
    for (const phone of step.fields) {
      if (phone.type !== "tel" || !phone.country_field) continue;
      const select = step.fields.find((f) => f.name === phone.country_field);
      if (!select || select.type !== "select" || !select.placeholder) continue;

      // "Nepal (NP)" -> "nepal"
      const hinted = select.placeholder.replace(/\(.*?\)/g, "").trim().toLowerCase();
      if (!hinted) continue;

      const match = select.options?.find((o) => o.label.trim().toLowerCase() === hinted);
      if (match) initial[select.name] = match.value;
    }
  }

  return initial;
}
