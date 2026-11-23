/**
 * "Untouched" for a lead somebody HOLDS — one absolute definition, independent of the Pulse window (Today / 7d / 30d
 * all give the same count for the same data): no call, email, meeting or note (`last_touched_at`) AND no stage/status
 * move (`stage_changed_at`) for UNTOUCHED_HELD_DAYS or more. Not deleted, not archived.
 *
 * Used by the attention row, the person-drawer "Untouched" tile, the "See the N leads" link (filter field
 * `untouched_held`, same cutoffs) and the briefing. The separate 48-hour rule is the intake alarm for NEW leads.
 */
export const UNTOUCHED_HELD_DAYS = 3;

export function untouchedHeldCutoff(now: Date = new Date()): string {
  return new Date(now.getTime() - UNTOUCHED_HELD_DAYS * 86_400_000).toISOString();
}
