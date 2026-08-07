import { FilterCompileError } from "./types";

// ★ SECURITY-CRITICAL FILE ★
//
// Three rules, in this order. Get these wrong and we ship a filter-injection hole:
//
// 1. Column names are NEVER derived from input. Every column string that reaches
//    these functions comes from a FieldSource literal in a field registry —
//    resolved and validated in compile.ts before any of these are called. There
//    must be no code path that splices an attacker string into the column
//    position. Same discipline as the existing SORT_COLUMNS allow-list
//    (route.ts:102-108) and its 422 regression test.
// 2. Operators are allow-listed per field type via isOperatorAllowed() (see
//    operators.ts) BEFORE compilation — not enforced here, enforced by the caller.
// 3. Values are always escaped — never "sanitized by deletion." This fixes a
//    live bug: `search.replace(/[,().]/g, "")` (route.ts:379) silently mangles
//    legitimate input like `o'brien@x.co.uk`. Proper quoting replaces deletion.

const NEEDS_QUOTE = /[,.:()"'\\{}[\]\s]/;

export function pgVal(raw: string): string {
  if (raw === "") return '""';
  if (!NEEDS_QUOTE.test(raw)) return raw;
  return `"${raw.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;
}

export type LikeMode = "contains" | "prefix" | "suffix" | "exact";

export function pgLike(raw: string, mode: LikeMode): string {
  // Escape the USER's own wildcard characters first, so a search for a literal
  // "50%" or "a_b" doesn't turn into a wildcard match…
  const lit = raw.replace(/([\\%_])/g, "\\$1");
  const pat = mode === "contains" ? `%${lit}%` : mode === "prefix" ? `${lit}%` : mode === "suffix" ? `%${lit}` : lit;
  // …THEN add ours outside the escape, and quote the whole thing through pgVal
  // so a value containing `,` `(` `)` etc. still can't break out of the value
  // position.
  return pgVal(pat);
}

const JSONB_KEY_RE = /^[a-z0-9_]{1,64}$/i;

export function pgCol(column: string, jsonPath?: string): string {
  if (jsonPath === undefined) return column;
  if (!JSONB_KEY_RE.test(jsonPath)) {
    throw new FilterCompileError(`invalid jsonb key: ${JSON.stringify(jsonPath)}`, "invalid_value");
  }
  return `${column}->>${jsonPath}`;
}

export const and = (...predicates: string[]): string => (predicates.length === 1 ? predicates[0] : `and(${predicates.join(",")})`);

export const or = (...predicates: string[]): string => (predicates.length === 1 ? predicates[0] : `or(${predicates.join(",")})`);

export const not = (predicate: string): string => `not.${predicate}`;

// Array literals — `tags.eq.{}` for "array is empty" — are always a bare
// constant built from nothing but the array's own element count, never from
// input values.
export const EMPTY_ARRAY_LITERAL = "{}";

export function arrayLiteral(values: string[]): string {
  return `{${values.map((v) => pgVal(v)).join(",")}}`;
}
