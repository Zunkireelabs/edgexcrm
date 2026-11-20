import type { CompileCtx, FieldDef, FieldRegistry } from "../types";

// Applications field registry (EDGEX-141 Phase 2) for the education Applications board.
//
// Three fields span applications AND leads, which PostgREST cannot OR across:
//   counsellor — effective counsellor = applications.assigned_to, else leads.assigned_to
//   student    — leads.first_name / last_name
//   search     — university / program (applications) OR student name (leads)
// They are `virtual` here and compile to NOTHING (null) through compileFilter. The one place that
// understands them is AT/lib/applications-query.ts, which splits each into disjoint branch queries
// and merges the results. They are only allowed in the top-level AND of a tree (planner check).
//
// This registry has no `embed` fields on purpose. The /applications page runs on the SERVICE
// client, so the GRANT trap from CLAUDE.md does not bite. Do NOT use this registry (or the
// applications-query helper's `leads` embed) on an RLS-context client without a
// `GRANT SELECT ... TO authenticated` on the embedded table in the same PR.

/** Registry keys the applications-query helper resolves itself (never through compileFilter). */
export const CROSS_TABLE_KEYS = ["counsellor", "student", "search"] as const;
export type CrossTableKey = (typeof CROSS_TABLE_KEYS)[number];

/** Registry keys offered first in the Filter menu (mockup state 4). */
export const APPLICATION_MOST_USED_KEYS = ["counsellor", "stage", "intake"];

const noop = () => null;

export function applicationFields(ctx: CompileCtx): FieldRegistry {
  void ctx;
  const industries = ["education_consultancy"];
  const fields: FieldDef[] = [
    {
      key: "counsellor",
      label: "Counsellor",
      type: "uuid",
      source: { kind: "virtual", compile: noop },
      group: "Basic",
      filterable: true,
      industries,
    },
    {
      key: "stage",
      label: "Stage",
      type: "uuid",
      source: { kind: "column", column: "stage_id" },
      operators: ["is", "is_not", "is_any_of", "is_none_of"],
      group: "Basic",
      filterable: true,
      industries,
    },
    {
      key: "intake",
      label: "Intake",
      type: "select",
      source: { kind: "column", column: "intake_term" },
      group: "Basic",
      filterable: true,
      industries,
    },
    {
      key: "university",
      label: "University",
      type: "text",
      source: { kind: "column", column: "university_name" },
      group: "Basic",
      filterable: true,
      sortable: true,
      sortColumns: ["university_name"],
      industries,
    },
    {
      key: "program",
      label: "Program",
      type: "text",
      source: { kind: "column", column: "program_name" },
      emptyIsBlankString: true,
      group: "Basic",
      filterable: true,
      industries,
    },
    {
      key: "country",
      label: "Country",
      type: "multiselect",
      source: { kind: "array_column", column: "countries" },
      group: "Basic",
      filterable: true,
      industries,
    },
    {
      key: "student",
      label: "Student",
      type: "text",
      source: { kind: "virtual", compile: noop },
      // Positive only: "not contains" would need the complement of a join predicate.
      operators: ["contains"],
      group: "Basic",
      filterable: true,
      industries,
    },
    {
      key: "offer_type",
      label: "Offer type",
      type: "select",
      source: { kind: "column", column: "offer_type" },
      options: [
        { value: "conditional", label: "Conditional" },
        { value: "unconditional", label: "Unconditional" },
      ],
      group: "Basic",
      filterable: true,
      industries,
    },
    {
      key: "deadline",
      label: "Deadline",
      type: "date",
      source: { kind: "column", column: "application_deadline" },
      group: "Dates",
      filterable: true,
      sortable: true,
      sortColumns: ["application_deadline"],
      industries,
    },
    {
      key: "fee_paid",
      label: "Fee paid",
      type: "boolean",
      source: { kind: "column", column: "application_fee_paid" },
      group: "Basic",
      filterable: true,
      industries,
    },
    {
      key: "time_in_stage",
      label: "Time in stage",
      type: "date",
      source: { kind: "column", column: "stage_changed_at" },
      group: "Dates",
      filterable: true,
      sortable: true,
      sortColumns: ["stage_changed_at"],
      industries,
    },
    {
      key: "created_at",
      label: "Created",
      type: "date",
      source: { kind: "column", column: "created_at" },
      group: "Dates",
      filterable: true,
      sortable: true,
      sortColumns: ["created_at"],
      industries,
    },
    {
      key: "updated_at",
      label: "Updated",
      type: "date",
      source: { kind: "column", column: "updated_at" },
      group: "Dates",
      filterable: true,
      sortable: true,
      sortColumns: ["updated_at"],
      industries,
    },
    {
      key: "search",
      label: "Search (university, program, student)",
      type: "text",
      source: { kind: "virtual", compile: noop },
      operators: ["contains"],
      group: "Basic",
      filterable: true,
      hiddenFromPicker: true,
      industries,
    },
  ];

  const registry: FieldRegistry = {};
  for (const f of fields) registry[f.key] = f;
  return registry;
}
