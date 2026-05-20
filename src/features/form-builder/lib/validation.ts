import type { FormStep, FormField } from "@/types/database";

export interface ValidationError {
  field: string;
  message: string;
}

export function slugify(text: string): string {
  return text
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

/** Convert text to a valid field name (lowercase_with_underscores) */
export function toFieldName(text: string): string {
  return text
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s_]/g, "")
    .replace(/\s+/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_|_$/g, "");
}

export function validateFormConfig(data: {
  name: string;
  slug: string;
  steps: FormStep[];
}): ValidationError[] {
  const errors: ValidationError[] = [];

  if (!data.name.trim()) {
    errors.push({ field: "name", message: "Form name is required" });
  }

  if (!data.slug.trim()) {
    errors.push({ field: "slug", message: "Slug is required" });
  } else if (!/^[a-z0-9-]+$/.test(data.slug)) {
    errors.push({ field: "slug", message: "Slug can only contain lowercase letters, numbers, and hyphens" });
  }

  if (!data.steps || data.steps.length === 0) {
    errors.push({ field: "steps", message: "At least one step is required" });
  } else {
    data.steps.forEach((step, stepIndex) => {
      if (!step.title.trim()) {
        errors.push({ field: `steps.${stepIndex}.title`, message: `Step ${stepIndex + 1} title is required` });
      }
      step.fields.forEach((field, fieldIndex) => {
        const fieldErrors = validateField(field, stepIndex, fieldIndex);
        errors.push(...fieldErrors);
      });
    });
  }

  return errors;
}

function validateField(field: FormField, stepIndex: number, fieldIndex: number): ValidationError[] {
  const errors: ValidationError[] = [];
  const prefix = `steps.${stepIndex}.fields.${fieldIndex}`;

  if (!field.name.trim()) {
    errors.push({ field: `${prefix}.name`, message: "Field name is required" });
  } else if (!/^[a-z_][a-z0-9_]*$/.test(field.name)) {
    errors.push({ field: `${prefix}.name`, message: "Field name must be lowercase with underscores only" });
  }

  if (!field.label.trim()) {
    errors.push({ field: `${prefix}.label`, message: "Field label is required" });
  }

  if ((field.type === "select" || field.type === "radio") && (!field.options || field.options.length === 0)) {
    errors.push({ field: `${prefix}.options`, message: "Select/radio fields must have at least one option" });
  }

  return errors;
}
