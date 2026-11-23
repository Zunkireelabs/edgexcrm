// Stage dot colour for the v2 grid and the filter "Pick values" popover (EDGEX-117).
// A non-null lead_lists.color always wins; otherwise fall back by slug so the two never disagree.

const SLUG_FALLBACK: Record<string, string> = {
  "pre-qualified": "var(--ds-faint)",
  qualified: "var(--ds-accent)",
  prospects: "var(--ds-warn)",
  applications: "var(--ds-good)",
};

export function stageDotColor(list: { slug?: string | null; color?: string | null } | null | undefined): string {
  if (list?.color) return list.color;
  return (list?.slug && SLUG_FALLBACK[list.slug]) || "var(--ds-ghost)";
}
