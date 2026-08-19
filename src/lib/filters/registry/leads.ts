import { and, or, pgVal } from "../pgrst";
import { FilterCompileError, type CompileCtx, type FieldDef, type FieldRegistry, type FilterCondition } from "../types";

// Lead field registry — Phase 2 of docs/ADVANCED-FILTERS-BRIEF.md. Covers the 9
// existing /api/v1/leads toolbar axes (status, search, form, tag, created,
// industry, source, assignees, collaborators) plus the "obvious first-class
// columns" the brief calls for. No `cf:*` custom fields yet — that's Phase 6.
//
// Every field here is deliberately scoped to match TODAY's legacy toolbar
// semantics byte-for-byte (see legacy-leads-params.ts + route.test.ts), not
// the more ambitious coalescing a few of the brief's registry notes describe.
//
//   - "status" -> the brief says virtual `stage_id ?? status`. This registry
//     is intentionally NOT that: it's strict single-column, targeting `status`
//     only — exactly what route.ts's `.eq('status', value)` does today. A
//     value-shape dispatch (UUID -> stage_id) was tried and reverted: it isn't
//     a no-op for every caller, because /api/v1/leads is reachable by any
//     authenticated session, not just the toolbar. `?status=<uuid>` today
//     resolves to `status.eq.<uuid>` -> zero rows (status is a VARCHAR(20)
//     CHECK-constrained column, so a UUID can never match); dispatching by
//     shape would silently turn that into a `stage_id.eq.<uuid>` match. Stage
//     gets its own FieldDef (-> stage_id) in Phase 3, coexisting with this one
//     exactly like `assigned_to` (scope) coexists with `assignees` (filter).
//   - "source" -> same reasoning, strict single-column targeting
//     `intake_source` only, matching route.ts's `.in('intake_source', ...)`.
//     The SEPARATE `form` field below still targets form_config_id directly
//     and unconditionally, exactly like route.ts's existing `?form=` handling.

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function asList(value: FilterCondition["value"]): string[] {
  if (Array.isArray(value)) return value as string[];
  return value === undefined ? [] : [String(value)];
}

// ── status: virtual, strict single-column (status only) ────────────────────

function compileStatus(cond: FilterCondition): string {
  if (cond.op === "is_empty") return "status.is.null";
  if (cond.op === "is_not_empty") return "status.not.is.null";

  const value = String(cond.value);
  if (cond.op === "is") return `status.eq.${pgVal(value)}`;
  // is_not — NULL-inclusive negation rule.
  return or("status.is.null", `status.neq.${pgVal(value)}`);
}

// ── source: virtual, strict single-column (intake_source only) ─────────────

function compileSource(cond: FilterCondition): string {
  if (cond.op === "is_empty") return "intake_source.is.null";
  if (cond.op === "is_not_empty") return "intake_source.not.is.null";

  const values = asList(cond.value);
  if (values.length === 0) throw new FilterCompileError(`${cond.op} requires at least one value`, "invalid_value");

  const isNeg = cond.op === "is_not" || cond.op === "is_none_of";
  if (!isNeg) {
    return values.length === 1 ? `intake_source.eq.${pgVal(values[0])}` : `intake_source.in.(${values.map(pgVal).join(",")})`;
  }
  // is_not / is_none_of — NULL-inclusive negation rule.
  return or("intake_source.is.null", values.length === 1 ? `intake_source.neq.${pgVal(values[0])}` : `intake_source.not.in.(${values.map(pgVal).join(",")})`);
}

// ── assignees: virtual — the "unassigned" sentinel + UUID-validated ids, ───
// matching route.ts's existing ?assignees= handling exactly, including its
// (surprising but current) fall-through-to-no-filter when every token is
// invalid and "unassigned" wasn't requested.

function compileAssignees(cond: FilterCondition): string | null {
  const values = asList(cond.value);
  const wantsUnassigned = values.includes("unassigned");
  const ids = values.filter((v) => v !== "unassigned" && UUID_RE.test(v));

  if (wantsUnassigned && ids.length > 0) return or("assigned_to.is.null", `assigned_to.in.(${ids.map(pgVal).join(",")})`);
  if (wantsUnassigned) return "assigned_to.is.null";
  if (ids.length > 0) return ids.length === 1 ? `assigned_to.eq.${pgVal(ids[0])}` : `assigned_to.in.(${ids.map(pgVal).join(",")})`;
  // No valid tokens — legacy applies no filter in this case (route.ts's
  // tri-branch has no final else). Dropping the condition (rather than
  // emitting the tautology "id.not.is.null") is identical to a no-op inside
  // AND, but is ALSO correct inside an OR group — a tautology there would
  // make the whole group match every row. See §0 of the Phase 3 brief.
  return null;
}

// ── location: virtual, city + country combined — no legacy equivalent ──────

function compileLocation(cond: FilterCondition): string {
  // Blank-string-inclusive, matching the sibling "city"/"country" FieldDefs
  // (both text, both emptyIsBlankString: true) — city/country IS NULL alone
  // previously disagreed with filtering City or Country directly, which also
  // treats "" as empty.
  if (cond.op === "is_empty") {
    return and(or("city.is.null", `city.eq.${pgVal("")}`), or("country.is.null", `country.eq.${pgVal("")}`));
  }
  if (cond.op === "is_not_empty") {
    return or(and("city.not.is.null", `city.neq.${pgVal("")}`), and("country.not.is.null", `country.neq.${pgVal("")}`));
  }
  const value = String(cond.value);
  const pattern = pgVal(`%${value.replace(/([\\%_])/g, "\\$1")}%`);
  if (cond.op === "contains") return or(`city.ilike.${pattern}`, `country.ilike.${pattern}`);
  // not_contains — De Morgan over the OR'd positive match, each leg NULL-inclusive:
  // NOT(city ilike P OR country ilike P) = (city IS NULL OR city NOT ilike P) AND (country IS NULL OR country NOT ilike P)
  return and(or("city.is.null", `city.not.ilike.${pattern}`), or("country.is.null", `country.not.ilike.${pattern}`));
}

// `ctx` is accepted (not yet read) so a future industry/permission-filtered
// registry — e.g. hiding field_of_study for a non-education tenant — is a
// change inside this function, not a signature change at every call site.
export function leadFields(ctx: CompileCtx): FieldRegistry {
  void ctx;
  const fields: FieldDef[] = [
    // ── toolbar axes ─────────────────────────────────────────────────────
    {
      key: "status",
      label: "Status",
      type: "select",
      source: { kind: "virtual", compile: compileStatus },
      operators: ["is", "is_not", "is_empty", "is_not_empty"],
      group: "Basic",
      filterable: true,
      sortable: false,
    },
    {
      key: "search",
      label: "Search (name, email, phone, ID)",
      type: "text",
      source: { kind: "columns", columns: ["first_name", "last_name", "email", "phone", "display_id"], fullNamePairs: true },
      group: "Basic",
      filterable: true,
    },
    {
      key: "form",
      label: "Form",
      type: "uuid",
      source: { kind: "column", column: "form_config_id" },
      group: "Basic",
      filterable: true,
    },
    {
      key: "tags",
      label: "Tags",
      type: "tags",
      source: { kind: "array_column", column: "tags" },
      group: "Basic",
      filterable: true,
    },
    {
      key: "created",
      label: "Created",
      type: "date",
      source: { kind: "column", column: "created_at" },
      group: "Dates",
      filterable: true,
      // Same column as "created_at" below — this entry exists only so the
      // legacy `?created=thisweek`-style URLs (legacy-leads-params.ts) still
      // resolve. Hidden from the picker so users see one "Created" option,
      // not two identical ones.
      hiddenFromPicker: true,
    },
    {
      key: "industry",
      label: "Prospect industry",
      type: "select",
      source: { kind: "column", column: "prospect_industry" },
      emptyIsBlankString: false,
      group: "Basic",
      filterable: true,
    },
    {
      key: "source",
      label: "Source",
      type: "select",
      source: { kind: "virtual", compile: compileSource },
      operators: ["is", "is_not", "is_any_of", "is_none_of", "is_empty", "is_not_empty"],
      group: "Basic",
      filterable: true,
    },
    {
      key: "assignees",
      label: "Assigned to",
      type: "uuid",
      source: { kind: "virtual", compile: compileAssignees },
      operators: ["is_any_of"],
      group: "Basic",
      filterable: true,
    },
    {
      key: "collaborators",
      label: "Collaborators",
      type: "relation",
      source: { kind: "embed", relation: "lead_collaborators", column: "user_id", embedSelect: "lead_collaborators!inner(user_id)" },
      operators: ["is_any_of"],
      group: "Basic",
      filterable: true,
    },

    // ── promoted legacy custom_fields dual-read ──────────────────────────
    {
      key: "field_of_study",
      label: "Field of study",
      type: "text",
      source: { kind: "promoted", column: "field_of_study", jsonb: { column: "custom_fields", path: "field_of_study" } },
      emptyIsBlankString: true,
      group: "Education",
      filterable: true,
      // Education-only — these two fields are meaningless outside education_consultancy
      // tenants (it_agency/travel_agency leads never populate them). Previously shown
      // in every tenant's "Add filter" picker regardless of industry (this `industries`
      // field on FieldDef existed but nothing read it yet — see compile.ts's
      // checkCondition + leads-table.tsx's advancedVisibleFields for enforcement).
      industries: ["education_consultancy"],
    },
    {
      key: "destinations",
      label: "Destinations",
      type: "multiselect",
      source: { kind: "promoted", column: "destinations", jsonb: { column: "custom_fields", path: "countries" } },
      group: "Education",
      filterable: true,
      industries: ["education_consultancy"],
    },

    // ── obvious first-class columns (also folds SORT_COLUMNS in) ─────────
    {
      key: "created_at",
      label: "Created at",
      type: "date",
      source: { kind: "column", column: "created_at" },
      group: "Dates",
      filterable: true,
      sortable: true,
      sortColumns: ["created_at"],
    },
    {
      key: "last_activity_at",
      label: "Last activity",
      type: "date",
      source: { kind: "column", column: "last_activity_at" },
      group: "Dates",
      filterable: true,
      sortable: true,
      sortColumns: ["last_activity_at"],
    },
    {
      key: "updated_at",
      label: "Updated at",
      type: "date",
      source: { kind: "column", column: "updated_at" },
      group: "Dates",
      filterable: true,
      sortable: true,
      sortColumns: ["updated_at"],
    },
    {
      key: "first_name",
      label: "Name",
      type: "text",
      source: { kind: "columns", columns: ["first_name", "last_name"], fullNamePairs: true },
      emptyIsBlankString: true,
      group: "Basic",
      filterable: true,
      sortable: true,
      sortColumns: ["first_name", "last_name"],
    },
    {
      key: "email",
      label: "Email",
      type: "text",
      source: { kind: "column", column: "email" },
      emptyIsBlankString: true,
      group: "Basic",
      filterable: true,
      sortable: true,
      sortColumns: ["email"],
    },
    {
      key: "phone",
      label: "Phone",
      type: "text",
      source: { kind: "column", column: "phone" },
      emptyIsBlankString: true,
      group: "Basic",
      filterable: true,
    },
    {
      key: "city",
      label: "City",
      type: "text",
      source: { kind: "column", column: "city" },
      emptyIsBlankString: true,
      group: "Basic",
      filterable: true,
    },
    {
      key: "country",
      label: "Country",
      type: "text",
      source: { kind: "column", column: "country" },
      emptyIsBlankString: true,
      group: "Basic",
      filterable: true,
    },
    {
      key: "location",
      label: "Location",
      type: "text",
      source: { kind: "virtual", compile: compileLocation },
      operators: ["contains", "not_contains", "is_empty", "is_not_empty"],
      group: "Basic",
      filterable: true,
    },

    // ── explicitly not filterable in Phase 2 ─────────────────────────────
    {
      key: "data_completeness",
      label: "Data completeness",
      type: "text",
      source: { kind: "column", column: "custom_fields" },
      group: "Basic",
      filterable: false,
    },
    {
      key: "next_task",
      label: "Next task",
      type: "text",
      source: { kind: "column", column: "custom_fields" },
      group: "Basic",
      filterable: false,
    },
    {
      key: "assigned_role",
      label: "Assigned role",
      type: "text",
      source: { kind: "column", column: "custom_fields" },
      group: "Basic",
      filterable: false,
    },
  ];

  const registry: FieldRegistry = {};
  for (const field of fields) registry[field.key] = field;
  return registry;
}
