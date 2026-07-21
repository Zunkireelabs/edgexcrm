// Supabase/PostgREST caps a plain .select() at a default max-rows limit (1000
// on this project). A campaign form with >1000 total submissions — normal for
// a multi-match prediction leaderboard — silently loses every row past that
// cap with no error, since no ORDER BY means Postgres has no defined order:
// in practice this returns whatever the planner scans first, which for an
// append-heavy table trends toward the OLDEST rows — so it's the LATEST
// submissions (typically the ones for later-round matches, since those
// matchups aren't even decided until earlier rounds play out) that go
// missing. Scoring, standings, and winner resolution then silently exclude
// anyone whose pick landed past the cap. Page through with .range() so every
// row is read regardless of table size.
const PAGE_SIZE = 1000;

// `db` is typed `any` deliberately — it's called with both the scopedClient
// wrapper and the raw Supabase client, and threading either's real generic
// query-builder type through here blows up TS ("excessively deep") the same
// way scoped.ts's own from() avoids doing for the same reason.
export async function fetchAllSubmissions<T>(
  db: any, // eslint-disable-line @typescript-eslint/no-explicit-any
  formConfigId: string,
  columns: string
): Promise<T[]> {
  const all: T[] = [];
  let from = 0;

  for (;;) {
    const { data, error } = await db
      .from("lead_submissions")
      .select(columns)
      .eq("form_config_id", formConfigId)
      .order("created_at", { ascending: true })
      .range(from, from + PAGE_SIZE - 1);

    if (error) throw new Error(error.message);

    const rows = (data ?? []) as T[];
    all.push(...rows);
    if (rows.length < PAGE_SIZE) break;
    from += PAGE_SIZE;
  }

  return all;
}
