import type { LeadList } from "@/types/database";

/**
 * "Off-funnel" lead lists are everything that is NOT part of the active forward
 * funnel (Pre-qualified → Qualified → Prospects → Applications):
 *   - any list flagged `is_archive` (e.g. "Archived")
 *   - the special "delete" list (which isn't flagged is_archive but is an exit list)
 *
 * These render as standalone items in the LEADS sidebar section and are excluded
 * from the "All Leads" funnel group and the lead-detail list stepper chain.
 */
export function isOffFunnelLeadList(
  list: Pick<LeadList, "slug"> & { is_archive?: boolean | null }
): boolean {
  return list.is_archive === true || list.slug === "delete";
}
