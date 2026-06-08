import type { FormStep } from "@/types/database";

export type FieldErrors = Record<string, string[]>;
export type ValidationResult = { valid: boolean; errors: FieldErrors };

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function validateSubmissionAgainstForm(
  steps: FormStep[] | null | undefined,
  values: Record<string, unknown>
): ValidationResult {
  if (!steps || steps.length === 0) return { valid: true, errors: {} };

  const errors: FieldErrors = {};

  for (const step of steps) {
    for (const field of step.fields) {
      // v1 limitation: file/entity_select can't be reliably validated from server payload
      if (field.type === "file" || field.type === "entity_select") continue;

      // Visibility: skip inactive conditional fields
      if (field.conditional) {
        const controllerValue = String(values[field.conditional.field] ?? "");
        if (!field.conditional.values.includes(controllerValue)) continue;
      }

      const v = values[field.name];
      const isEmpty =
        v == null ||
        (typeof v === "string" && v.trim() === "") ||
        (Array.isArray(v) && v.length === 0);

      if (field.required && isEmpty) {
        errors[field.name] = [...(errors[field.name] ?? []), "This field is required"];
        continue;
      }

      if (isEmpty) continue;

      const fieldErrors: string[] = [];

      if (field.type === "email") {
        if (!EMAIL_RE.test(String(v))) {
          fieldErrors.push("Must be a valid email address");
        }
      } else if (field.type === "number") {
        const n = Number(v);
        if (!isFinite(n)) {
          fieldErrors.push("Must be a valid number");
        } else {
          if (field.validation?.min !== undefined && n < field.validation.min) {
            fieldErrors.push(`Must be at least ${field.validation.min}`);
          }
          if (field.validation?.max !== undefined && n > field.validation.max) {
            fieldErrors.push(`Must be at most ${field.validation.max}`);
          }
        }
      } else if (field.type === "date") {
        const parsed = Date.parse(String(v));
        if (isNaN(parsed)) {
          fieldErrors.push("Must be a valid date");
        } else {
          const strV = String(v);
          if (field.validation?.min_date && strV < field.validation.min_date) {
            fieldErrors.push(`Date must be on or after ${field.validation.min_date}`);
          }
          if (field.validation?.max_date && strV > field.validation.max_date) {
            fieldErrors.push(`Date must be on or before ${field.validation.max_date}`);
          }
        }
      } else if (field.type === "select" || field.type === "radio") {
        if (field.options && field.options.length > 0) {
          const validValues = field.options.map((o) => o.value);
          if (Array.isArray(v)) {
            for (const item of v) {
              if (!validValues.includes(String(item))) {
                fieldErrors.push(`"${String(item)}" is not a valid option`);
              }
            }
          } else if (!validValues.includes(String(v))) {
            fieldErrors.push(`"${String(v)}" is not a valid option`);
          }
        }
      } else if (field.type === "checkbox") {
        if (field.options && field.options.length > 0) {
          const validValues = field.options.map((o) => o.value);
          const vals = Array.isArray(v) ? v : [v];
          for (const item of vals) {
            if (!validValues.includes(String(item))) {
              fieldErrors.push(`"${String(item)}" is not a valid option`);
            }
          }
        }
        // no options declared → free-form checkbox → skip membership check
      }
      // text | textarea | tel: no format check beyond required

      if (field.validation?.pattern) {
        try {
          const re = new RegExp(field.validation.pattern);
          if (!re.test(String(v))) {
            fieldErrors.push("Value does not match the required format");
          }
        } catch {
          // malformed pattern — skip silently
        }
      }

      if (fieldErrors.length > 0) {
        errors[field.name] = [...(errors[field.name] ?? []), ...fieldErrors];
      }
    }
  }

  return { valid: Object.keys(errors).length === 0, errors };
}
