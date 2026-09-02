/**
 * Safe construction of a PostgREST `.or()` "contains" search across several
 * text columns from a user- or model-supplied search term.
 *
 * ## Why this exists
 *
 * Interpolating a caller-supplied string straight into a PostgREST filter
 * expression —
 *
 * ```ts
 * query.or(`first_name.ilike.%${search}%,last_name.ilike.%${search}%`)
 * ```
 *
 * — is an injection sink. PostgREST parses that string with its own grammar,
 * so `,` `.` `(` `)` `"` in `search` become *syntax*, not data. A caller can:
 *
 *  - inject extra predicates on columns the endpoint never exposes
 *    (`search=zzz,is_final.is.true,first_name.ilike.%` widens the result set),
 *  - collapse the term to a match-all (`search=%`) and pull the whole table,
 *  - turn an unbounded token loose in a 4-way OR over an indexed column
 *    (a cheap full-scan / DoS amplifier).
 *
 * Tenant scoping and the `deleted_at IS NULL` filter are applied as separate
 * top-level `.eq()` / `.is()` calls, so an injected `tenant_id` / `deleted_at`
 * predicate inside the OR group cannot override them — but everything above is
 * still real exposure. Every *other* filter on these routes is parameterised
 * (`.eq()`, `.ilike()`); search was the one hand-built spot.
 *
 * ## The fix
 *
 * `supabase-js` has no parameterised multi-column OR builder, so we sanitise
 * the term before it reaches `.or()`:
 *
 *  1. Wrap the value in a PostgREST double-quoted string — inside quotes
 *     `, . ( ) :` are literal, not expression syntax.
 *  2. Escape the only two characters that can break out of that quoting:
 *     `\` -> `\\` and `"` -> `\"`.
 *  3. Strip the `%` LIKE wildcard so the term can only ever be a literal
 *     substring operand (kills the match-all bypass). `_` is left as-is — a
 *     single-character wildcard is harmless and keeps emails/handles usable.
 *  4. Replace control characters and cap the length.
 *
 * An ordinary search — `O'Brien`, `Smith, J`, `john.doe@x.com` — still works
 * as a real substring match; only the expression metacharacters are neutered.
 */

export const SEARCH_TERM_MAX_LENGTH = 100;

// Matches C0 control chars (U+0000-U+001F) and DEL (U+007F).
const CONTROL_CHARS = /[\u0000-\u001F\u007F]+/g;

/**
 * Normalise a raw search term into a value that is safe to embed inside a
 * PostgREST double-quoted `ilike` pattern. Returns `""` when nothing usable
 * survives (callers should then skip the search filter entirely).
 */
export function sanitizeSearchTerm(
  raw: string,
  maxLength: number = SEARCH_TERM_MAX_LENGTH,
): string {
  const trimmed = raw
    .replace(CONTROL_CHARS, " ") // newlines / NUL / DEL -> space
    .replace(/\s+/g, " ") // collapse whitespace runs
    .trim()
    .slice(0, Math.max(0, maxLength));

  return trimmed
    .replace(/\\/g, "\\\\") // escape backslash first
    .replace(/"/g, '\\"') // then the quote that would end the value
    .replace(/%/g, ""); // drop the LIKE wildcard — term is a literal operand
}

/**
 * Build a PostgREST `.or()` group that matches `rawTerm` as a case-insensitive
 * substring against every column in `columns`.
 *
 * @returns the `.or()` argument string, or `null` when the sanitised term is
 *          empty (caller should not call `.or()` at all).
 *
 * @example
 * const group = buildIlikeOrFilter(["first_name", "last_name"], search);
 * if (group) query = query.or(group);
 */
export function buildIlikeOrFilter(
  columns: readonly string[],
  rawTerm: string,
  opts: { maxLength?: number } = {},
): string | null {
  const term = sanitizeSearchTerm(rawTerm, opts.maxLength ?? SEARCH_TERM_MAX_LENGTH);
  if (!term) return null;
  return columns.map((col) => `${col}.ilike."%${term}%"`).join(",");
}
