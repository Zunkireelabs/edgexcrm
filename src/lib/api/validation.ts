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

export function isUUID(): ValidatorFn {
  return (value) => {
    if (!value || typeof value !== "string") return null;
    const uuidRegex =
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (!uuidRegex.test(value)) return "Invalid UUID format";
    return null;
  };
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

export function isPositiveInt(): ValidatorFn {
  return (value) => {
    if (value === undefined || value === null) return null;
    const num = Number(value);
    if (!Number.isInteger(num) || num < 1) return "Must be a positive integer";
    return null;
  };
}
