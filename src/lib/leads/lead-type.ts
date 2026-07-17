// Lead "type" is the single category stored at tags[0] (migration 098_lead_types.sql).
// education_consultancy currently has two: "student" and "other" (walk-in Contacts).
// "parent" is a retired value (PR #209) folded into "other" (migration 157); we still
// treat any lingering "parent"-tagged lead as Other here so the UI is correct even on
// a database that hasn't run migration 157 yet (e.g. prod before promotion).

const OTHER_TAG_VALUES = ["other", "parent"] as const;

/**
 * True when this lead is an "Other" walk-in Contact — i.e. not a real pipeline lead.
 * Such leads are excluded from Stages/Pipeline and have Status/Stage hidden on the
 * detail page. Scoped to education_consultancy, where the tag has this meaning.
 */
export function isOtherLead(
  tags: string[] | null | undefined,
  industryId: string | null | undefined,
): boolean {
  if (industryId !== "education_consultancy") return false;
  return (tags ?? []).some((t) => (OTHER_TAG_VALUES as readonly string[]).includes(t));
}
