// Bounded-concurrency fan-out. docs/SMS-PHASE4-BRIEF.md item 4:
// getOrCreateOptOutToken (each call an insert+select round trip) used to run
// through an unbounded Promise.all — it took down local Supabase at 249
// recipients during Phase 3B testing with `TypeError: fetch failed`, and
// Admizz's real audience is ~16,000. Any per-recipient DB fan-out on the send
// path must go through this instead of a raw Promise.all(items.map(...)).

export async function mapWithConcurrency<T, R>(items: T[], limit: number, fn: (item: T, index: number) => Promise<R>): Promise<R[]> {
  if (items.length === 0) return [];
  const boundedLimit = Math.max(1, Math.min(limit, items.length));
  const results: R[] = new Array(items.length);
  let nextIndex = 0;

  async function worker(): Promise<void> {
    for (;;) {
      const i = nextIndex++;
      if (i >= items.length) return;
      results[i] = await fn(items[i], i);
    }
  }

  await Promise.all(Array.from({ length: boundedLimit }, worker));
  return results;
}
