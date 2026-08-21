import { isValidPhoneForCountry } from "@/lib/phone-utils";

type ValidatorFn = (value: unknown) => string | null;

export function validate(
  data: Record<string, unknown>,
  rules: Record<string, ValidatorFn[]>
): { valid: boolean; errors: Record<string, string[]> } {
  const errors: Record<string, string[]> = {};

  for (const [field, validators] of Object.entries(rules)) {
    const value = data[field];
    for (const validator of validators) {
      const error = validator(value);
      if (error) {
        if (!errors[field]) errors[field] = [];
        errors[field].push(error);
      }
    }
  }

  return { valid: Object.keys(errors).length === 0, errors };
}

export function required(fieldName: string): ValidatorFn {
  return (value) => {
    if (value === undefined || value === null || value === "") {
      return `${fieldName} is required`;
    }
    return null;
  };
}

export function isEmail(): ValidatorFn {
  return (value) => {
    if (!value || typeof value !== "string") return null;
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(value)) return "Invalid email address";
    return null;
  };
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUUID(): ValidatorFn {
  return (value) => {
    if (!value || typeof value !== "string") return null;
    if (!UUID_RE.test(value)) return "Invalid UUID format";
    return null;
  };
}

// Reads a query-string param and returns it ONLY when it's uuid-shaped, else
// null. The one-line guard a GET route should use before handing a raw
// searchParams value to .eq()/.in() against a uuid-typed column — a
// malformed value there throws a raw Postgres 22P02 ("invalid input syntax
// for type uuid") that crashes the WHOLE request, not just that filter.
// This was a real, independently-repeated production bug (leads, tasks,
// deals all had it) before this helper existed — see the leads route's own
// ?stage=/?assigned_to=/?branch_id= handling for the pattern this codifies,
// and src/lib/filters/compile.ts's sanitizeUuidCondition for the equivalent
// guard inside the filter-tree system specifically.
export function uuidSearchParam(searchParams: URLSearchParams, key: string): string | null {
  const value = searchParams.get(key);
  return value && UUID_RE.test(value) ? value : null;
}

export function isIn(allowed: string[]): ValidatorFn {
  return (value) => {
    if (!value || typeof value !== "string") return null;
    if (!allowed.includes(value)) {
      return `Must be one of: ${allowed.join(", ")}`;
    }
    return null;
  };
}

export function maxLength(n: number): ValidatorFn {
  return (value) => {
    if (!value || typeof value !== "string") return null;
    if (value.length > n) return `Must be at most ${n} characters`;
    return null;
  };
}

export function optionalMaxLength(n: number): ValidatorFn {
  return (value) => {
    if (value === undefined || value === null || value === "") return null;
    if (typeof value !== "string") return null;
    if (value.length > n) return `Must be at most ${n} characters`;
    return null;
  };
}

/**
 * Country-aware phone format check (libphonenumber-js via isValidPhoneForCountry).
 * Optional field — only validates when a value is present. Callers gate this
 * per-industry (education_consultancy only) rather than baking the gate in here.
 */
export function isPhoneForCountry(): ValidatorFn {
  return (value) => {
    if (!value || typeof value !== "string") return null;
    if (!isValidPhoneForCountry(value)) {
      return "Please enter a valid phone number for the selected country";
    }
    return null;
  };
}

export function isPositiveInt(): ValidatorFn {
  return (value) => {
    if (value === undefined || value === null) return null;
    const num = Number(value);
    if (!Number.isInteger(num) || num < 1) return "Must be a positive integer";
    return null;
  };
}
