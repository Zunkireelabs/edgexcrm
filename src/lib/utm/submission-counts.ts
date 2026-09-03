import type { ScopedClient } from "@/lib/supabase/scoped";

function norm(v: string | null | undefined): string {
  return (v ?? "").trim().toLowerCase();
}

export function keyOf(source: string | null, medium: string | null, campaign: string | null): string {
  return `${norm(source)}|${norm(medium)}|${norm(campaign)}`;
}

// PostgREST caps an unpaged select at 1000 rows. Admizz alone has 16k+ leads,
// so a plain .select() here silently only ever saw an arbitrary slice of old
// data — recently created leads (the ones a fresh tracking link actually
// produces) were never even fetched, let alone matched. Page through the
// full table instead.
const PAGE_SIZE = 1000;

export async function computeSubmissionCounts(
  db: ScopedClient,
  links: Array<{ utm_source: string | null; utm_medium: string | null; utm_campaign: string | null }>
): Promise<Map<string, number>> {
  const countByKey = new Map<string, number>();
  if (links.length === 0) return countByKey;

  let offset = 0;
  for (;;) {
    const { data: leadRows, error } = await db
      .from("leads")
      .select("intake_source, intake_medium, intake_campaign")
      .is("deleted_at", null)
      .range(offset, offset + PAGE_SIZE - 1);

    if (error) {
      console.error("computeSubmissionCounts: leads query failed", error);
      break;
    }
    if (!leadRows || leadRows.length === 0) break;

    for (const row of leadRows as unknown as Array<{
      intake_source: string | null;
      intake_medium: string | null;
      intake_campaign: string | null;
    }>) {
      const s = norm(row.intake_source);
      const m = norm(row.intake_medium);
      const c = norm(row.intake_campaign);
      if (!s && !m && !c) continue;
      const key = `${s}|${m}|${c}`;
      countByKey.set(key, (countByKey.get(key) ?? 0) + 1);
    }

    if (leadRows.length < PAGE_SIZE) break;
    offset += PAGE_SIZE;
  }

  return countByKey;
}
