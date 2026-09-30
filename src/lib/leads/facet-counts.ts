// Facet counts derived from the list's own query.
//
// Each candidate's count is one caller-supplied count query (the route passes the SAME
// buildScopedQuery the page uses, head:true — see route.ts §COUNT-SPLIT). This module owns
// only the fan-out: bounded concurrency, drop-zero, sort, and fail-loud on any error so a
// half-answered facet is never rendered as if it were complete.

export interface FacetOption {
  name: string;
  count: number;
}

export interface CountResult {
  count: number | null;
  error: { message: string } | null;
}

export const FACET_COUNT_CONCURRENCY = 6;

export async function countFacetOptions(
  candidates: readonly string[],
  countFor: (candidate: string) => PromiseLike<CountResult>,
  concurrency: number = FACET_COUNT_CONCURRENCY,
): Promise<FacetOption[]> {
  const unique = [...new Set(candidates)];
  const results: FacetOption[] = [];
  let next = 0;

  async function worker() {
    while (next < unique.length) {
      const candidate = unique[next++];
      const { count, error } = await countFor(candidate);
      if (error) throw new Error(`facet count failed for "${candidate}": ${error.message}`);
      if (count && count > 0) results.push({ name: candidate, count });
    }
  }

  await Promise.all(Array.from({ length: Math.min(Math.max(1, concurrency), unique.length) }, worker));
  return results.sort((a, b) => b.count - a.count || a.name.localeCompare(b.name));
}
