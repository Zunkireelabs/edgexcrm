/**
 * Pure, React-free helper for rendering a declarative NavSection[] layout
 * (see NavSection in _types.ts and IT_AGENCY_NAV_LAYOUT in
 * it-agency/nav-layout.ts). Kept out of shell.tsx so the "an empty section
 * renders no header" rule is unit-testable without React Testing Library —
 * this project has none (see shell.nav.test.ts).
 */

export interface ResolvedNavSection<K extends string, TNode> {
  id: string;
  label?: string;
  /** Non-null resolved entries only, in layout order, each still keyed by its entry key. */
  items: readonly { key: K; node: TNode }[];
}

/**
 * Resolves each section's entry keys via `resolve`, dropping entries that
 * resolve to null. A section whose entries all resolve to null is dropped
 * entirely — including its header — rather than returned with an empty
 * `items` array, so callers never have to remember to check for that case.
 */
export function resolveNavSections<K extends string, TNode>(
  layout: readonly { id: string; label?: string; entries: readonly K[] }[],
  resolve: (key: K) => TNode | null,
): ResolvedNavSection<K, TNode>[] {
  return layout.flatMap((section) => {
    const items = section.entries
      .map((key) => ({ key, node: resolve(key) }))
      .filter((it): it is { key: K; node: TNode } => it.node !== null);
    return items.length === 0 ? [] : [{ id: section.id, label: section.label, items }];
  });
}
