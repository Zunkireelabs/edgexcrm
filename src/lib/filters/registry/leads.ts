import { and, or, pgLike, pgVal } from "../pgrst";
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
//     shape would silently turn that into a `stage_id.eq.<uuid>` match.
//     CORRECTION (this file previously planned a "Stage" FieldDef -> `stage_id`
//     here — do not build that): in the live dashboard UI, "Stage" already
//     means `list_id`/`lead_lists` (the sidebar tabs — Pre-qualified, Qualified,
//     Prospects, Applications; see CLAUDE.md's "Lead Lists = 'Stage' in UI").
//     `stage_id`/`pipeline_stages` is what the UI calls "Status" (columns-
//     registry.tsx), and this "status" field above already covers it via the
//     `status` mirror column, whose value is kept in lockstep with `stage_id`
//     (route.ts always writes both together) and is scoped per-list already
//     (see leads-table.tsx's statusFilterOptions). The real "Stage" FieldDef
//     (-> list_id) is below, next to this one.
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
  // assigned_to is a plain nullable column (unlike Collaborators' join table),
  // so is_empty/is_not_empty/is_none_of are ordinary column comparisons — no
  // !inner-join trap here, unlike Collaborators (see that field's comment in
  // leadFields() below for why is_empty/is_none_of stay OFF there).
  if (cond.op === "is_empty") return "assigned_to.is.null";
  if (cond.op === "is_not_empty") return "assigned_to.not.is.null";

  const values = asList(cond.value);
  const wantsUnassigned = values.includes("unassigned");
  const ids = values.filter((v) => v !== "unassigned" && UUID_RE.test(v));

  if (cond.op === "is_none_of") {
    // Mirrors the is_any_of branches below, negated — but "unassigned" stays
    // an explicit, independently-toggleable bucket rather than getting the
    // blanket NULL-inclusive safety net compileStatus/compileSource apply to
    // *unset* data. Here NULL already has its own first-class opt-in/opt-out
    // via the "unassigned" sentinel, so auto-including it would make it
    // impossible to express "exclude these people, but still show unassigned
    // leads" (the ids-only branch) as distinct from "exclude these people AND
    // unassigned leads" (the unassigned+ids branch).
    const negatedIds = () => (ids.length === 1 ? `assigned_to.neq.${pgVal(ids[0])}` : `assigned_to.not.in.(${ids.map(pgVal).join(",")})`);
    if (wantsUnassigned && ids.length > 0) return and("assigned_to.not.is.null", negatedIds());
    if (wantsUnassigned) return "assigned_to.not.is.null";
    if (ids.length > 0) return or("assigned_to.is.null", negatedIds());
    // No valid tokens — same no-op fallback as is_any_of below (§0 fix).
    return null;
  }

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
  // starts_with/ends_with mirror contains exactly (OR across both columns) —
  // only the wildcard placement differs. No negative form exists for either
  // (matching every other text field in this registry — the FilterOperator
  // union has no "not_starts_with"/"not_ends_with" at all).
  if (cond.op === "contains" || cond.op === "starts_with" || cond.op === "ends_with") {
    const mode = cond.op === "contains" ? "contains" : cond.op === "starts_with" ? "prefix" : "suffix";
    const pattern = pgLike(value, mode);
    return or(`city.ilike.${pattern}`, `country.ilike.${pattern}`);
  }
  // not_contains — De Morgan over the OR'd positive match, each leg NULL-inclusive:
  // NOT(city ilike P OR country ilike P) = (city IS NULL OR city NOT ilike P) AND (country IS NULL OR country NOT ilike P)
  const pattern = pgLike(value, "contains");
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
      key: "stage",
      label: "Stage",
      type: "uuid",
      source: { kind: "column", column: "list_id" },
      group: "Basic",
      filterable: true,
      // Lead Lists ("Stage" in the UI) is gated to the industries that have
      // FEATURES.LEAD_LISTS enabled — src/industries/_shared/features/lead-lists/meta.ts.
      // Literal industry ids here (not a registry import), matching field_of_study/
      // destinations below — keep in sync with that meta's `industries` if it changes.
      industries: ["education_consultancy", "travel_agency", "it_agency"],
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
      operators: ["is_any_of", "is_none_of", "is_empty", "is_not_empty"],
      group: "Basic",
      filterable: true,
    },
    {
      key: "collaborators",
      label: "Collaborators",
      type: "relation",
      source: {
        kind: "embed",
        relation: "lead_collaborators",
        column: "user_id",
        embedSelect: "lead_collaborators!inner(user_id)",
        // Mig 210: a trigger-maintained counter on leads, used ONLY for
        // is_empty. The !inner join above can prove a collaborator EXISTS,
        // never that none does — this sidesteps that instead of trying to
        // express "no matching row" through the join at all. See its comment
        // in compile.ts's "embed" render case for the full reasoning.
        emptyColumn: "collaborator_count",
      },
      // is_not_empty is safe on top of is_any_of: the embedSelect above is an
      // `!inner` join, so any row that survives it already has >=1
      // collaborator — is_not_empty just states that fact explicitly.
      // is_none_of is still NOT offered: excluding SPECIFIC people has no
      // equivalent to the emptyColumn escape hatch (a count alone can't say
      // WHO) — it would still need the NOT-EXISTS-shaped query this field's
      // is_empty was rewritten specifically to avoid. See compile.ts's
      // requireOperator for the enforced rejection.
      operators: ["is_any_of", "is_not_empty", "is_empty"],
      group: "Basic",
      filterable: true,
    },

    // ── promoted legacy custom_fields dual-read ──────────────────────────
    {
      key: "field_of_study",
      label: "Field of study",
      // Was `type: "text"` (free-typed `contains`/`starts_with` search) until the
      // Admizz request to make it a fixed dropdown instead — options now come from
      // the tenant's own Settings > Courses catalog (leads-table.tsx's
      // advancedFilterOptionOverrides.field_of_study, sourced via useEduTaxonomy()),
      // never a hardcoded list here. `select` gets is/is_not/is_any_of/is_none_of
      // instead of contains/starts_with — see OPERATORS_BY_TYPE.
      type: "select",
      source: { kind: "promoted", column: "field_of_study", jsonb: { column: "custom_fields", path: "field_of_study" } },
      emptyIsBlankString: true,
      group: "Education",
      filterable: true,
      // Education-only — these fields are meaningless outside education_consultancy
      // tenants (it_agency/travel_agency leads never populate them). Previously shown
      // in every tenant's "Add filter" picker regardless of industry (this `industries`
      // field on FieldDef existed but nothing read it yet — see compile.ts's
      // checkCondition + leads-table.tsx's advancedVisibleFields for enforcement).
      industries: ["education_consultancy"],
    },
    {
      key: "degree_level",
      label: "Level of study",
      // Same shape as field_of_study above (promoted scalar, dropdown, education-only)
      // — added alongside the field_of_study text->select conversion per the same
      // Admizz request. Options come from the tenant's Settings > Interested Degree
      // Level catalog (leads-table.tsx's advancedFilterOptionOverrides.degree_level,
      // via useEduTaxonomy()'s studyLevels), never a hardcoded list here.
      type: "select",
      source: { kind: "promoted", column: "degree_level", jsonb: { column: "custom_fields", path: "degree_level" } },
      emptyIsBlankString: true,
      group: "Education",
      filterable: true,
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
      // "is"/"is not" stay excluded — there's no single value to equal across
      // two combined columns (same reasoning as Collaborators/Assigned-to's
      // exclusions above). starts_with/ends_with now match City/Country's own
      // full operator set — see compileLocation.
      operators: ["contains", "not_contains", "starts_with", "ends_with", "is_empty", "is_not_empty"],
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
