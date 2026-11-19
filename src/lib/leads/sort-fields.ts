// Sort fields for the Leads table: the UI names, their GET /api/v1/leads `sort` keys, and which column header sorts by
// what. Kept in its own file so a contract test can prove every key here is allow-listed by the server
// (src/lib/filters/registry/leads.ts) — a typo would otherwise be a 422 only a user would ever see.
//
// Pure — no React, no DB.

export type SortField =
  | "activity"
  | "created"
  | "updated"
  | "name"
  | "email"
  | "follow_up_needed"
  // Column-header sorts (Nov 2026) — plain stored columns, sorted by the server (serverPaginated mode only).
  | "phone"
  | "location"
  | "source"
  | "industry"
  | "ref_code"
  | "form_source"
  | "medium"
  | "campaign"
  | "preferred_contact"
  | "ai_score"
  | "company"
  | "designation"
  | "salutation"
  | "company_email"
  | "archived_at";

// UI sort field -> GET /api/v1/leads `sort` param. Values are matched against the
// lead field registry's FieldDef key (src/lib/filters/registry/leads.ts) since the
// API resolves `sort` by looking up that key directly, not a raw column name — see
// route.ts's `filterRegistry[sortKey]` lookup. follow_up_needed reuses that FieldDef's
// sortColumns/sortNullsFirst rather than re-deriving the sort rule here.
// callback_due is NOT a sort option — it's an automatic, unconditional display-order
// float applied after whatever sort is active (see the displayLeads partition below).
export const SORT_FIELD_TO_API: Record<SortField, string> = {
  activity: "last_activity_at",
  created: "created_at",
  updated: "updated_at",
  name: "first_name",
  email: "email",
  follow_up_needed: "follow_up_needed",
  // Column-header sorts — each is a registry key marked sortable in src/lib/filters/registry/leads.ts.
  phone: "phone",
  location: "location",
  source: "source",
  industry: "industry",
  ref_code: "ref_code",
  form_source: "form_source",
  medium: "intake_medium",
  campaign: "intake_campaign",
  preferred_contact: "preferred_contact_method",
  ai_score: "ai_score",
  company: "company_name",
  designation: "designation",
  salutation: "salutation",
  company_email: "company_email",
  archived_at: "archived_at",
};

// Which column header sorts by which SortField. A column NOT listed here has no sort icon — either its value is not a
// plain stored column (Assigned, Stage, Status, Branch, Tags, Form, Owner, calculated scores … they need a database
// lookup to sort correctly) or it is not worth sorting. Better no icon than a wrong order.
export const COLUMN_SORT_FIELD: Record<string, SortField> = {
  name: "name",
  email: "email",
  phone: "phone",
  location: "location",
  source: "source",
  ref_code: "ref_code",
  form_source: "form_source",
  medium: "medium",
  campaign: "campaign",
  last_activity: "activity",
  created: "created",
  updated_at: "updated",
  preferred_contact: "preferred_contact",
  ai_score: "ai_score",
  company: "company",
  designation: "designation",
  prospect_industry: "industry",
  salutation: "salutation",
  company_email: "company_email",
  archived_at: "archived_at",
};

// Dates and scores read best "biggest / most recent first", so their first header click is descending.
export const DESC_FIRST_SORT_FIELDS = new Set<SortField>(["activity", "created", "updated", "ai_score", "archived_at"]);

// Extra Sort-popover entries, so the popover always shows what a header click made active.
export const HEADER_SORT_LABELS: Array<[SortField, string]> = [
  ["phone", "Phone"],
  ["location", "Location"],
  ["source", "Source"],
  ["ref_code", "Ref code"],
  ["form_source", "Form source"],
  ["medium", "Medium"],
  ["campaign", "Campaign"],
  ["preferred_contact", "Preferred contact"],
  ["ai_score", "AI score"],
  ["company", "Company"],
  ["designation", "Designation"],
  ["industry", "Prospect industry"],
  ["salutation", "Salutation"],
  ["company_email", "Company email"],
  ["archived_at", "Archived date"],
];
