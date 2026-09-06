// PostgREST silently caps an unpaged select at 1000 rows — no error, no
// truncation signal. Any query that needs a real count/total over a table
// that can exceed 1000 rows for one tenant (leads, sms_messages,
// email_messages, ...) must page through with .range() or it will quietly
// under-report. This bit blast materialization three times over
// (src/lib/outbound/audience.ts's lead fetch, the SMS send route's
// already-materialized check, and the credit-total/finalize queries fixed
// alongside this helper) before being extracted here — use this instead of
// hand-rolling a fourth copy of the same loop.

export interface PageResult<T> {
  data: T[] | null;
  error: { message: string } | null;
}

/**
 * Fetches every row from a query by paging with .range(offset, offset + pageSize - 1)
 * until a page comes back shorter than pageSize. `buildQuery` must apply the
 * same filters on every call — only the range differs.
 */
export async function fetchAllRows<T>(buildQuery: (offset: number, limit: number) => PromiseLike<PageResult<T>>, pageSize = 1000): Promise<T[]> {
  const rows: T[] = [];
  for (let offset = 0; ; offset += pageSize) {
    const { data, error } = await buildQuery(offset, pageSize);
    if (error) throw new Error(error.message);
    const page = data ?? [];
    rows.push(...page);
    if (page.length < pageSize) break;
  }
  return rows;
}
