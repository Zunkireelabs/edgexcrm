/**
 * The lead page's heading styles — one source of truth, so a title never has to be re-styled
 * per card (and can't quietly drift, which is how the page ended up with three looks).
 *
 * SECTION_TITLE_CLASS — the title of a top-level section or card (left column sections and
 *   right column cards alike). Heavier, darker and larger than the 12px labels under it, so it
 *   reads as a heading and not as another label.
 * SUBHEADING_CLASS — a heading one level down, inside a section (e.g. "Academic Qualification").
 *
 * Group titles ("Personal Information", Title Case) and box titles ("Basic Details") in the
 * center Student Details card are separate levels with their own styles.
 */
export const SECTION_TITLE_CLASS = "text-[13px] font-semibold uppercase tracking-wider text-foreground";
export const SUBHEADING_CLASS = "text-[11px] font-semibold uppercase tracking-wider text-muted-foreground";
