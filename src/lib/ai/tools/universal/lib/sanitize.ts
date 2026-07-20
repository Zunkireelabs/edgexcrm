import { z } from "zod";

/**
 * gpt-4o-mini fills every optional tool parameter with placeholder junk
 * (empty strings, an all-zero UUID) instead of omitting it, regardless of
 * provider/strict-mode settings. Wrap optional zod fields with these so a
 * placeholder value parses to `undefined` instead of silently becoming a
 * real filter — tool input is untrusted model output for any provider.
 */
export const NIL_UUID = "00000000-0000-0000-0000-000000000000";

function isBlankString(value: unknown): value is string {
  return typeof value === "string" && value.trim() === "";
}

/** Blank/whitespace-only string -> undefined. For optional string fields. */
export function optionalString<T extends z.ZodTypeAny>(schema: T) {
  return z.preprocess((val) => (isBlankString(val) ? undefined : val), schema);
}

const FILTER_SENTINELS = new Set(["all", "any", "none", "*"]);

function isFilterSentinel(value: unknown): value is string {
  return typeof value === "string" && FILTER_SENTINELS.has(value.trim().toLowerCase());
}

/**
 * Blank/whitespace-only string, or a plausible "include everything" sentinel
 * ("all"/"any"/"none"/"*", case-insensitive) -> undefined. For optional
 * filter fields that resolve via an exact lookup (e.g. a slug), where a
 * sentinel value silently short-circuits to "not found" / zero rows instead
 * of surfacing as an obvious placeholder like an empty string would.
 */
export function optionalFilterString<T extends z.ZodTypeAny>(schema: T) {
  return z.preprocess((val) => (isBlankString(val) || isFilterSentinel(val) ? undefined : val), schema);
}

/** Blank string or the NIL UUID -> undefined. For optional uuid fields. */
export function optionalUuid<T extends z.ZodTypeAny>(schema: T) {
  return z.preprocess((val) => {
    if (isBlankString(val)) return undefined;
    if (typeof val === "string" && val.trim().toLowerCase() === NIL_UUID) return undefined;
    return val;
  }, schema);
}
