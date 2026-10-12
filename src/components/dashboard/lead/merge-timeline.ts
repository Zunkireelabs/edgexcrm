// The Notes tab shows typed notes AND the calls and meetings logged for the lead, in one list, newest first.
// Notes keep the order they already have (the page hands them over newest-first); the extra entries (calls / meetings)
// are slotted in by date. A merge of two ordered lists — never a re-sort of the notes — so adding the extras can't
// shuffle notes among themselves.

export interface DatedEntry {
  /** ISO timestamp the entry is ordered by. */
  at: string;
}

const time = (e: DatedEntry) => {
  const t = new Date(e.at).getTime();
  return Number.isNaN(t) ? 0 : t;
};

/** Merges `primary` (kept in its given order) with `extras` (sorted newest-first here), newest first overall. Ties keep the primary entry first. */
export function mergeNewestFirst<P extends DatedEntry, X extends DatedEntry>(
  primary: readonly P[],
  extras: readonly X[]
): Array<{ source: "primary"; entry: P } | { source: "extra"; entry: X }> {
  const sortedExtras = [...extras].sort((a, b) => time(b) - time(a));
  const out: Array<{ source: "primary"; entry: P } | { source: "extra"; entry: X }> = [];
  let i = 0;
  let j = 0;
  while (i < primary.length || j < sortedExtras.length) {
    if (j >= sortedExtras.length || (i < primary.length && time(primary[i]) >= time(sortedExtras[j]))) {
      out.push({ source: "primary", entry: primary[i++] });
    } else {
      out.push({ source: "extra", entry: sortedExtras[j++] });
    }
  }
  return out;
}
