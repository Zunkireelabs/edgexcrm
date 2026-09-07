// PostgREST silently caps an unpaged select at 1000 rows — no error, no
// truncation signal. Any query that needs a real count/total over a table
// that can exceed 1000 rows for one tenant (leads, sms_messages,
// email_messages, ...) must page through with .range() or it will quietly
// under-report. This bit blast materialization three times over
// (src/lib/outbound/audience.ts's lead fetch, the SMS send route's
// already-materialized check, and the credit-total/finalize queries fixed
// alongside this helper) before being extracted here — use this instead of
// hand-rolling a fourth copy of the same loop.
//
// ORDERING CONTRACT: `buildQuery` MUST apply a deterministic TOTAL order
// (e.g. `.order("id", { ascending: true })`) before its `.range(...)`.
// Offset pagination over an unordered result is not safe: Postgres
// guarantees no row order without ORDER BY, so a row sitting on a page
// boundary can be returned twice (on two pages) or skipped entirely. This
// only bites above `pageSize` rows — exactly the scale this helper exists
// for — and produces no error, so a small test will not catch it. The
// precedent that solved this correctly in this repo, with the same
// reasoning, is
// src/industries/education-consultancy/features/campaigns/lib/fetch-submissions.ts.
// `id` alone is enough for the blast tables: those primary keys are UUIDs,
// so `ORDER BY id` is a fully deterministic total order, and the only
// concurrent writes during these reads are UPDATEs to `status`
// (materialization always completes before the send worker starts) — an
// UPDATE never changes `id`, so the order is stable across pages.

// Upper bound on total rows fetchAllRows will accumulate before it THROWS.
// It holds every row in memory (this container has an OOM history — the
// 2026-08 leads-crm leak), and every real caller here pages a single
// tenant's blast recipients: Admizz's largest audience is ~16.7k, so 200k
// is ~12x headroom over the worst legitimate case while still catching a
// runaway (an unfiltered query, a bad buildQuery) long before it exhausts
// the heap. Throwing — not silently truncating — because silent truncation
// is the exact bug class this helper exists to prevent.
const DEFAULT_MAX_ROWS = 200_000;

export interface PageResult<T> {
  data: T[] | null;
  error: { message: string } | null;
}

/**
 * Fetches every row from a query by paging with .range(offset, offset + pageSize - 1)
 * until a page comes back shorter than pageSize. `buildQuery` must apply the
 * same filters on every call — only the range differs — AND must apply a
 * deterministic total order (see the ORDERING CONTRACT note above); an
 * unordered result can skip or duplicate a row at a page boundary. Throws if
 * the accumulated row count exceeds `maxRows`.
 */
export async function fetchAllRows<T>(
  buildQuery: (offset: number, limit: number) => PromiseLike<PageResult<T>>,
  pageSize = 1000,
  maxRows = DEFAULT_MAX_ROWS
): Promise<T[]> {
  const rows: T[] = [];
  for (let offset = 0; ; offset += pageSize) {
    const { data, error } = await buildQuery(offset, pageSize);
    if (error) throw new Error(error.message);
    const page = data ?? [];
    rows.push(...page);
    if (rows.length > maxRows) {
      throw new Error(`fetchAllRows: exceeded maxRows (${maxRows}) — refusing to accumulate an unbounded result set`);
    }
    if (page.length < pageSize) break;
  }
  return rows;
}
