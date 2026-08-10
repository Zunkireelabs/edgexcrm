import { and, arrayLiteral, EMPTY_ARRAY_LITERAL, or, pgCol, pgLike, pgVal } from "./pgrst";
import { isOperatorAllowed } from "./operators";
import {
  FilterCompileError,
  NEGATIVE_OPERATORS,
  type CompileCtx,
  type FieldDef,
  type FieldRegistry,
  type FilterCondition,
  type FilterTree,
} from "./types";

// compileFilter() — the one predicate implementation all four hand-maintained
// mirrors (getLeads/getLeadsPage, the route.ts inline chain, lead_aggregates(),
// search-leads.ts) are meant to eventually route through.
//
// THE INVARIANT THAT KEEPS TENANT ISOLATION INTACT — DO NOT VIOLATE IT:
// compileFilter receives a builder and returns a builder. It must NEVER call
// .from(), .select() or .rpc(). Tenant scoping, the leads_visible_to_user RPC,
// pipeline/list allow-lists and shared-pool logic all stay exactly where they
// are, applied by the CALLER before/after this function runs. A compiler that
// constructs its own base query will either leak the whole tenant to a
// counselor or return zero rows — both have precedent in this repo.
//
// THE NEGATION RULE — the #1 correctness trap, and it is deliberate:
// In SQL, `col <> 'x'` evaluates to NULL (i.e. EXCLUDES the row) when
// `col IS NULL`. So a naive "status is not Contacted" silently hides every
// lead with no status — users read that as data loss. Every operator in
// NEGATIVE_OPERATORS (is_not, not_contains, is_none_of) compiles to
// `or(<col>.is.null, <negation>)`. Notion, Airtable and Twenty all behave
// this way. See compile.test.ts's "negation includes empty rows" suite.
//
// GROUP SEMANTICS (this module's own contract — there are zero consumers yet,
// so this is the first place these semantics are defined):
//   - `tree.conditions` combine with each other via `tree.conjunction`.
//   - Each entry in `tree.groups` is an independent bracketed clause (its own
//     conjunction governs the conditions inside it).
//   - The root-conditions clause and every group clause are ANDed together —
//     i.e. "(root conditions joined by tree.conjunction) AND (group 1) AND
//     (group 2) AND …". This matches the Notion/Twenty UX: a top-level
//     AND/OR toggle plus independent "+ Add filter group" blocks.

export interface QueryBuilder {
  eq(column: string, value: unknown): this;
  neq(column: string, value: unknown): this;
  is(column: string, value: null | boolean): this;
  in(column: string, values: readonly unknown[]): this;
  gt(column: string, value: unknown): this;
  gte(column: string, value: unknown): this;
  lt(column: string, value: unknown): this;
  lte(column: string, value: unknown): this;
  ilike(column: string, pattern: string): this;
  contains(column: string, value: readonly unknown[] | Record<string, unknown>): this;
  overlaps(column: string, value: readonly unknown[]): this;
  not(column: string, operator: string, value: unknown): this;
  or(filters: string): this;
}

function requireField(registry: FieldRegistry, key: string): FieldDef {
  const field = registry[key];
  if (!field) throw new FilterCompileError(`unknown filter field: ${JSON.stringify(key)}`, "unknown_field");
  if (!field.filterable) throw new FilterCompileError(`field is not filterable: ${JSON.stringify(key)}`, "not_filterable");
  return field;
}

function requireOperator(field: FieldDef, cond: FilterCondition): void {
  if (!isOperatorAllowed(field, cond.op)) {
    throw new FilterCompileError(`operator ${cond.op} is not allowed on field ${field.key}`, "operator_not_allowed");
  }
  if (field.source.kind === "embed" && cond.op === "is_none_of") {
    // !inner + not.in means "has *a* collaborator who isn't X" — semantically
    // wrong (and duplicates parent rows), not "has none of X". Reject even if
    // a caller's registry override mistakenly allow-lists it.
    throw new FilterCompileError("is_none_of is not supported on relation fields", "unsupported");
  }
}

function isNegative(op: FilterCondition["op"]): boolean {
  return NEGATIVE_OPERATORS.includes(op);
}

// ── Date-window helpers (tz-aware, ctx.now-injected — never Date.now()) ─────

// `dateStr`'s first 10 chars (YYYY-MM-DD) are the target LOCAL calendar date
// in `tz` — taken as-is, never round-tripped through `new Date(dateStr)`
// first. Doing that round-trip would anchor the string to UTC midnight and
// then re-derive the date by formatting in `tz`, which silently shifts the
// calendar day for any negative-offset zone (e.g. UTC midnight formatted in
// America/New_York is the previous evening) — exactly the trap this function
// exists to avoid.
function localMidnightUtc(dateStr: string, tz: string): Date {
  const datePart = dateStr.slice(0, 10);
  // naiveUtc: the target date's midnight, misinterpreted as a UTC instant.
  const naiveUtc = new Date(`${datePart}T00:00:00.000Z`);
  // Format that (wrong) instant in `tz`, then re-parse those wall-clock digits
  // as if THEY were UTC — the difference from naiveUtc is exactly tz's offset
  // at this date (correct across DST since it's evaluated at this specific date).
  const asTzWallClock = naiveUtc.toLocaleString("sv-SE", { timeZone: tz }).replace(" ", "T") + "Z";
  const offsetMs = naiveUtc.getTime() - new Date(asTzWallClock).getTime();
  return new Date(naiveUtc.getTime() + offsetMs);
}

function nextCalendarDate(dateStr: string): string {
  const d = new Date(`${dateStr.slice(0, 10)}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

// `end` is the NEXT calendar date's own local midnight — NOT `start + 24h`.
// On a DST transition day (e.g. America/New_York, second Sunday of March)
// the wall-clock day is only 23 hours; a fixed +24h offset would silently
// leak one hour of the FOLLOWING day into an "on <that date>" filter. See
// compile.test.ts's DST-transition-day coverage.
function dayBoundsInTz(dateStr: string, tz: string): { start: string; end: string } {
  return {
    start: localMidnightUtc(dateStr, tz).toISOString(),
    end: localMidnightUtc(nextCalendarDate(dateStr), tz).toISOString(),
  };
}

function parseRelativeWindow(value: string): { amount: number; unit: "d" | "m" | "y" } {
  const match = /^(\d+)([dmy])$/.exec(value);
  if (!match) throw new FilterCompileError(`invalid relative date value: ${JSON.stringify(value)}`, "invalid_value");
  return { amount: Number(match[1]), unit: match[2] as "d" | "m" | "y" };
}

function addRelativeWindow(base: Date, value: string): Date {
  const { amount, unit } = parseRelativeWindow(value);
  const result = new Date(base.getTime());
  if (unit === "d") result.setUTCDate(result.getUTCDate() + amount);
  else if (unit === "m") result.setUTCMonth(result.getUTCMonth() + amount);
  else result.setUTCFullYear(result.getUTCFullYear() + amount);
  return result;
}

// ── Predicate rendering: FieldDef + FilterCondition -> a single pgrst string ─
// (or a list of legs, for the "promoted" dual-read trap, which the caller
// combines via De Morgan.)

function renderScalarOpAgainstColumn(
  col: string,
  op: FilterCondition["op"],
  value: FilterCondition["value"],
  field: FieldDef,
  isArrayColumn: boolean
): string {
  switch (op) {
    case "is":
      return `${col}.eq.${pgVal(String(value))}`;
    case "is_not":
      return `${col}.neq.${pgVal(String(value))}`;
    case "is_empty":
      if (isArrayColumn) return or(`${col}.is.null`, `${col}.eq.${EMPTY_ARRAY_LITERAL}`);
      return field.type === "text" || field.emptyIsBlankString === true
        ? or(`${col}.is.null`, `${col}.eq.${pgVal("")}`)
        : `${col}.is.null`;
    case "is_not_empty":
      if (isArrayColumn) return and(`${col}.not.is.null`, `${col}.neq.${EMPTY_ARRAY_LITERAL}`);
      return field.type === "text" || field.emptyIsBlankString === true
        ? and(`${col}.not.is.null`, `${col}.neq.${pgVal("")}`)
        : `${col}.not.is.null`;
    case "contains":
      return `${col}.ilike.${pgLike(String(value), "contains")}`;
    case "not_contains":
      return `${col}.not.ilike.${pgLike(String(value), "contains")}`;
    case "starts_with":
      return `${col}.ilike.${pgLike(String(value), "prefix")}`;
    case "ends_with":
      return `${col}.ilike.${pgLike(String(value), "suffix")}`;
    case "gt":
      return `${col}.gt.${pgVal(String(value))}`;
    case "gte":
      return `${col}.gte.${pgVal(String(value))}`;
    case "lt":
      return `${col}.lt.${pgVal(String(value))}`;
    case "lte":
      return `${col}.lte.${pgVal(String(value))}`;
    case "between": {
      const [min, max] = value as [number, number];
      return and(`${col}.gte.${pgVal(String(min))}`, `${col}.lte.${pgVal(String(max))}`);
    }
    case "is_true":
      return `${col}.eq.true`;
    case "is_false":
      return `${col}.eq.false`;
    default:
      throw new FilterCompileError(`operator ${op} has no scalar rendering`, "unsupported");
  }
}

function renderListOpAgainstColumn(col: string, op: FilterCondition["op"], values: string[], isArrayColumn: boolean): string {
  if (isArrayColumn) {
    switch (op) {
      case "is_any_of":
        return `${col}.ov.${arrayLiteral(values)}`;
      case "is_none_of":
        return `${col}.not.ov.${arrayLiteral(values)}`;
      case "has_all":
        return `${col}.cs.${arrayLiteral(values)}`;
      default:
        throw new FilterCompileError(`operator ${op} has no array rendering`, "unsupported");
    }
  }
  switch (op) {
    case "is_any_of":
      return `${col}.in.(${values.map(pgVal).join(",")})`;
    case "is_none_of":
      return `${col}.not.in.(${values.map(pgVal).join(",")})`;
    case "has_all":
      // Scalar columns can't "contain all" of a list of discrete values —
      // registries must not offer has_all on a non-array field.
      throw new FilterCompileError("has_all requires an array_column/tags field", "unsupported");
    default:
      throw new FilterCompileError(`operator ${op} has no list rendering`, "unsupported");
  }
}

function renderDateOpAgainstColumn(col: string, op: FilterCondition["op"], value: FilterCondition["value"], ctx: CompileCtx): string {
  switch (op) {
    case "is_empty":
      return `${col}.is.null`;
    case "is_not_empty":
      return `${col}.not.is.null`;
    case "before":
      return `${col}.lt.${pgVal(new Date(String(value)).toISOString())}`;
    case "after":
      return `${col}.gt.${pgVal(new Date(String(value)).toISOString())}`;
    case "on": {
      const { start, end } = dayBoundsInTz(String(value), ctx.tz);
      return and(`${col}.gte.${pgVal(start)}`, `${col}.lt.${pgVal(end)}`);
    }
    case "date_between": {
      const [from, to] = value as [string, string];
      const startBound = dayBoundsInTz(from, ctx.tz);
      const endBound = dayBoundsInTz(to, ctx.tz);
      return and(`${col}.gte.${pgVal(startBound.start)}`, `${col}.lt.${pgVal(endBound.end)}`);
    }
    case "within_last": {
      const since = subtractRelativeWindow(ctx.now, String(value));
      return and(`${col}.gte.${pgVal(since.toISOString())}`, `${col}.lte.${pgVal(ctx.now.toISOString())}`);
    }
    case "within_next": {
      const until = addRelativeWindow(ctx.now, String(value));
      return and(`${col}.gte.${pgVal(ctx.now.toISOString())}`, `${col}.lte.${pgVal(until.toISOString())}`);
    }
    default:
      throw new FilterCompileError(`operator ${op} has no date rendering`, "unsupported");
  }
}

function subtractRelativeWindow(base: Date, value: string): Date {
  const { amount, unit } = parseRelativeWindow(value);
  const result = new Date(base.getTime());
  if (unit === "d") result.setUTCDate(result.getUTCDate() - amount);
  else if (unit === "m") result.setUTCMonth(result.getUTCMonth() - amount);
  else result.setUTCFullYear(result.getUTCFullYear() - amount);
  return result;
}

function renderAgainstColumn(col: string, field: FieldDef, cond: FilterCondition): string {
  const isArrayColumn = field.source.kind === "array_column" || field.type === "tags" || field.type === "multiselect";
  if (field.type === "date") return renderDateOpAgainstColumn(col, cond.op, cond.value, currentCtxRef);
  if (Array.isArray(cond.value) && (cond.op === "is_any_of" || cond.op === "is_none_of" || cond.op === "has_all")) {
    return renderListOpAgainstColumn(col, cond.op, cond.value as string[], isArrayColumn);
  }
  return renderScalarOpAgainstColumn(col, cond.op, cond.value, field, isArrayColumn);
}

// `renderAgainstColumn` needs ctx for date math but stays a narrow function for
// the non-date branches; threading ctx through every call site would obscure
// the branch structure above, so it's captured via a module-scoped ref that
// `compileCondition` sets immediately before rendering. Never read outside a
// synchronous render call.
let currentCtxRef: CompileCtx;

// Positive-vs-negative wrapping: negative operators always include the NULL
// leg. This wrapping happens ONCE, at the top, so every column-kind branch
// below stays free of the trap.
function renderConditionPredicate(col: string, field: FieldDef, cond: FilterCondition): string {
  const rendered = renderAgainstColumn(col, field, cond);
  if (!isNegative(cond.op)) return rendered;
  return or(`${col}.is.null`, rendered);
}

function renderPromotedPredicate(field: FieldDef & { source: Extract<FieldDef["source"], { kind: "promoted" }> }, cond: FilterCondition): string {
  const realCol = field.source.column;
  const jsonCol = pgCol(field.source.jsonb.column, field.source.jsonb.path);
  const realLeg = renderAgainstColumn(realCol, field, cond);
  const jsonLeg = renderAgainstColumn(jsonCol, field, cond);

  if (!isNegative(cond.op)) {
    // Positive ops OR the two legs — either the real column or the legacy
    // custom_fields path satisfying the condition is enough. Without this,
    // legacy Admizz education rows silently vanish from e.g. "Field of study
    // is X" because their data lives only in custom_fields.
    return or(realLeg, jsonLeg);
  }

  // Negative ops AND the two NEGATED legs (De Morgan): NOT(a OR b) = NOT a AND
  // NOT b. Each leg itself still gets the NULL-inclusive wrapping so a row
  // missing BOTH the real column and the legacy path still matches "is not X".
  const negRealLeg = or(`${realCol}.is.null`, realLeg);
  const negJsonLeg = or(`${jsonCol}.is.null`, jsonLeg);
  return and(negRealLeg, negJsonLeg);
}

function renderColumnsPredicate(field: FieldDef & { source: Extract<FieldDef["source"], { kind: "columns" }> }, cond: FilterCondition): string {
  const { columns, fullNamePairs } = field.source;
  const isNeg = isNegative(cond.op);
  // Render each column's leg using the RAW operator (never wrapped here) — the
  // null-inclusive wrapping is applied once, below, at the combination step,
  // not per-leg, because for a multi-column field the trap fix isn't "wrap
  // each leg" (that would compute an OR of ORs) but "AND the null-inclusive
  // negation of every column" (De Morgan over the whole set) — see the isNeg
  // branch below.
  const legs = columns.map((c) => renderAgainstColumn(c, field, cond));

  if (!isNeg && fullNamePairs && columns.length >= 2 && typeof cond.value === "string") {
    // "John Smith" won't match any single column — match token pairs against
    // the first two columns in either order (mirrors route.ts's full-name
    // search special-case). Only meaningful for a positive "contains"-style
    // match; there is no sound negation of a token-pair match, so it's
    // skipped for negative operators.
    const tokens = cond.value.trim().split(/\s+/).filter(Boolean);
    if (tokens.length >= 2) {
      const [a, b] = columns;
      const [t1, t2] = tokens;
      legs.push(
        and(renderAgainstColumn(a, field, { ...cond, value: t1 }), renderAgainstColumn(b, field, { ...cond, value: t2 })),
        and(renderAgainstColumn(a, field, { ...cond, value: t2 }), renderAgainstColumn(b, field, { ...cond, value: t1 }))
      );
    }
  }

  if (!isNeg) return or(...legs);

  // Negative: "does not match in ANY column" = AND over columns of
  // (column IS NULL OR column does-not-match) — a row with a NULL column is
  // never, by itself, a reason to exclude the row from a "not contains" match.
  const negatedLegs = columns.map((c, i) => or(`${c}.is.null`, legs[i]));
  return and(...negatedLegs);
}

function renderCondition(field: FieldDef, cond: FilterCondition, ctx: CompileCtx): string | null {
  currentCtxRef = ctx;

  switch (field.source.kind) {
    case "column":
      return renderConditionPredicate(field.source.column, field, cond);
    case "array_column":
      return renderConditionPredicate(field.source.column, field, cond);
    case "jsonb":
      return renderConditionPredicate(pgCol(field.source.column, field.source.path), field, cond);
    case "promoted":
      return renderPromotedPredicate(field as FieldDef & { source: Extract<FieldDef["source"], { kind: "promoted" }> }, cond);
    case "columns":
      return renderColumnsPredicate(field as FieldDef & { source: Extract<FieldDef["source"], { kind: "columns" }> }, cond);
    case "embed": {
      // Dotted relation.column filtering an embedded resource. The caller is
      // responsible for including that relation in the select with `!inner`
      // (e.g. `lead_collaborators!inner(user_id)`) — the compiler never calls
      // .select(), so it cannot arrange that itself. is_none_of is rejected in
      // requireOperator() before this is reached.
      const dotted = `${field.source.relation}.${field.source.column}`;
      return renderConditionPredicate(dotted, field, cond);
    }
    case "virtual":
      // The field owns its own translation (e.g. status -> stage_id ?? status).
      // Negation-NULL wrapping is the field's responsibility here since only it
      // knows the real column(s) involved.
      return field.source.compile(cond, ctx);
    default: {
      const exhaustive: never = field.source;
      throw new FilterCompileError(`unhandled field source kind: ${JSON.stringify(exhaustive)}`, "unsupported");
    }
  }
}

function resolveAndValidate(registry: FieldRegistry, cond: FilterCondition): FieldDef {
  const field = requireField(registry, cond.field);
  requireOperator(field, cond);

  if ((cond.op === "is_any_of" || cond.op === "is_none_of" || cond.op === "has_all") && Array.isArray(cond.value) && cond.value.length === 0) {
    // Belt-and-suspenders: schema.ts already enforces .min(1), but a caller
    // that hand-builds a tree (bypassing decodeFilterTree) must not get a
    // silent no-op — the empty-pipeline-allow-list incident is exactly this
    // shape of bug, just on a different filter axis.
    throw new FilterCompileError(`${cond.op} requires at least one value`, "invalid_value");
  }

  return field;
}

type SimpleColumnField = FieldDef & { source: Extract<FieldDef["source"], { kind: "column" } | { kind: "array_column" }> };

// A condition is eligible for the NATIVE fast path — a plain .eq/.in/.gte/…
// builder call instead of a constructed filter string — only when it is a
// single-column, single-call, positive predicate. Everything else (negative
// operators needing the NULL-inclusive OR, multi-leg promoted/columns fields,
// embedded-relation filters, and date operators which all need tz-aware
// string construction) falls back to the string path via a per-condition
// `.or(predicate)` call, which still ANDs correctly with every other filter
// param PostgREST sees — see the module doc comment's "GROUP SEMANTICS".
function isNativeEligible(field: FieldDef, cond: FilterCondition): boolean {
  if (isNegative(cond.op)) return false;
  if (field.source.kind !== "column" && field.source.kind !== "array_column") return false;
  if (field.type === "date") return false;
  if (
    (cond.op === "is_empty" || cond.op === "is_not_empty") &&
    (field.type === "text" || field.source.kind === "array_column" || field.emptyIsBlankString === true)
  ) {
    return false; // needs a compound OR/AND (NULL-or-blank), not a single call
  }
  return true;
}

function applyNative<B extends QueryBuilder>(builder: B, field: SimpleColumnField, cond: FilterCondition): B {
  const col = field.source.column;
  const isArrayColumn = field.source.kind === "array_column";
  switch (cond.op) {
    case "is":
      return builder.eq(col, cond.value);
    case "is_empty":
      return builder.is(col, null);
    case "is_not_empty":
      return builder.not(col, "is", null);
    case "contains":
      return builder.ilike(col, pgLike(String(cond.value), "contains"));
    case "starts_with":
      return builder.ilike(col, pgLike(String(cond.value), "prefix"));
    case "ends_with":
      return builder.ilike(col, pgLike(String(cond.value), "suffix"));
    case "gt":
      return builder.gt(col, cond.value);
    case "gte":
      return builder.gte(col, cond.value);
    case "lt":
      return builder.lt(col, cond.value);
    case "lte":
      return builder.lte(col, cond.value);
    case "between": {
      const [min, max] = cond.value as [number, number];
      return builder.gte(col, min).lte(col, max);
    }
    case "is_any_of": {
      const values = cond.value as string[];
      return isArrayColumn ? builder.overlaps(col, values) : builder.in(col, values);
    }
    case "has_all": {
      const values = cond.value as string[];
      return builder.contains(col, values);
    }
    case "is_true":
      return builder.eq(col, true);
    case "is_false":
      return builder.eq(col, false);
    default:
      throw new FilterCompileError(`operator ${cond.op} has no native rendering`, "unsupported");
  }
}

function applyConditionToBuilder<B extends QueryBuilder>(builder: B, registry: FieldRegistry, cond: FilterCondition, ctx: CompileCtx): B {
  const field = resolveAndValidate(registry, cond);

  if (isNativeEligible(field, cond)) {
    return applyNative(builder, field as SimpleColumnField, cond);
  }

  const predicate = renderCondition(field, cond, ctx);
  // §0 fix: a condition that contributes nothing (e.g. compileAssignees with
  // no valid tokens) is dropped rather than compiled to a tautology. Inside
  // AND this is a no-op either way; the drop only matters for applyOrConditions
  // below, but the rule lives at render time so it's uniform everywhere.
  if (predicate === null) return builder;
  return builder.or(predicate);
}

function applyAndConditions<B extends QueryBuilder>(builder: B, registry: FieldRegistry, conditions: FilterCondition[], ctx: CompileCtx): B {
  let out = builder;
  for (const cond of conditions) out = applyConditionToBuilder(out, registry, cond, ctx);
  return out;
}

// A true OR clause cannot be expressed as separate builder calls (those AND
// together) — every condition in the clause is rendered to a predicate string
// and combined into ONE `.or(...)` call.
function applyOrConditions<B extends QueryBuilder>(builder: B, registry: FieldRegistry, conditions: FilterCondition[], ctx: CompileCtx): B {
  if (conditions.length === 0) return builder;
  const parts = conditions
    .map((cond) => {
      const field = resolveAndValidate(registry, cond);
      return renderCondition(field, cond, ctx);
    })
    // §0 fix: a null leg contributes nothing and must be dropped, never joined
    // in as a tautology — or(<dropped>, X) must compile to just X, not to
    // something that matches every row. If every leg drops, the whole group
    // contributes nothing (no .or() call at all), not `or()` of nothing.
    .filter((p): p is string => p !== null);
  if (parts.length === 0) return builder;
  return builder.or(or(...parts));
}

/**
 * compileFilter(builder, tree, registry, ctx) -> builder
 *
 * Receives a builder, returns a builder. Never calls .from()/.select()/.rpc() —
 * see the module doc comment above for why that invariant is load-bearing.
 *
 * Pure-AND trees use native builder calls wherever a condition allows it (the
 * fast path — see isNativeEligible). Root-level OR and each `groups[]` entry
 * with conjunction "or" fall back to one constructed `.or(...)` filter string
 * per clause, per the module doc comment's GROUP SEMANTICS.
 */
export function compileFilter<B extends QueryBuilder>(builder: B, tree: FilterTree, registry: FieldRegistry, ctx: CompileCtx): B {
  let out =
    tree.conjunction === "and"
      ? applyAndConditions(builder, registry, tree.conditions, ctx)
      : applyOrConditions(builder, registry, tree.conditions, ctx);

  for (const group of tree.groups ?? []) {
    out =
      group.conjunction === "and"
        ? applyAndConditions(out, registry, group.conditions, ctx)
        : applyOrConditions(out, registry, group.conditions, ctx);
  }

  return out;
}

export type PlanFilterResult = { ok: true; embeds: string[] } | { ok: false; errors: Record<string, string[]> };

// planFilter() validates every condition in a tree UP FRONT and collects every
// error, instead of compileFilter's throw-on-first-bad-condition — a caller
// building a route response needs every validation problem in a single 422,
// not just the first one. It also answers the ordering question a caller like
// the leads route has: `.select()` must know about any `embed`-kind condition
// (to add the `!inner(...)` join) BEFORE compileFilter ever runs, since
// compileFilter itself never calls .select() (see the module doc comment).
function checkCondition(
  cond: FilterCondition,
  registry: FieldRegistry,
  ctx: CompileCtx,
  errors: Record<string, string[]>,
  embeds: Set<string>
): void {
  const push = (msg: string) => (errors[cond.field] ??= []).push(msg);

  const field = registry[cond.field];
  if (!field) {
    push(`unknown filter field: ${JSON.stringify(cond.field)}`);
    return;
  }
  if (!field.filterable) {
    push(`field is not filterable: ${JSON.stringify(cond.field)}`);
    return;
  }
  if (field.visibleTo && !field.visibleTo(ctx.permissions)) {
    push(`field is not accessible: ${JSON.stringify(cond.field)}`);
    return;
  }
  if (!isOperatorAllowed(field, cond.op)) {
    push(`operator ${cond.op} is not allowed on field ${field.key}`);
    return;
  }
  if (field.source.kind === "embed" && cond.op === "is_none_of") {
    push("is_none_of is not supported on relation fields");
    return;
  }
  if (
    (cond.op === "is_any_of" || cond.op === "is_none_of" || cond.op === "has_all") &&
    Array.isArray(cond.value) &&
    cond.value.length === 0
  ) {
    push(`${cond.op} requires at least one value`);
    return;
  }

  if (field.source.kind === "embed") embeds.add(field.source.embedSelect);
}

export function planFilter(tree: FilterTree, registry: FieldRegistry, ctx: CompileCtx): PlanFilterResult {
  const errors: Record<string, string[]> = {};
  const embeds = new Set<string>();

  for (const cond of tree.conditions) checkCondition(cond, registry, ctx, errors, embeds);
  for (const group of tree.groups ?? []) {
    for (const cond of group.conditions) checkCondition(cond, registry, ctx, errors, embeds);
  }

  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return { ok: true, embeds: Array.from(embeds) };
}
