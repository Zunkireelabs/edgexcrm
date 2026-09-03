import type { ScopedClient } from "@/lib/supabase/scoped";

function norm(v: string | null | undefined): string {
  return (v ?? "").trim().toLowerCase();
}

export function keyOf(source: string | null, medium: string | null, campaign: string | null): string {
  return `${norm(source)}|${norm(medium)}|${norm(campaign)}`;
}

export async function computeSubmissionCounts(
  db: ScopedClient,
  links: Array<{ utm_source: string | null; utm_medium: string | null; utm_campaign: string | null }>
): Promise<Map<string, number>> {
  const countByKey = new Map<string, number>();
  if (links.length === 0) return countByKey;

  const { data: leadRows, error } = await db
    .from("leads")
    .select("intake_source, intake_medium, intake_campaign")
    .is("deleted_at", null);

  console.log("[UTM-DEBUG] requested link keys:", links.map((l) => keyOf(l.utm_source, l.utm_medium, l.utm_campaign)));

  if (error || !leadRows) {
    console.error("computeSubmissionCounts: leads query failed", error);
    console.log("[UTM-DEBUG] query errored — error object:", JSON.stringify(error));
    return countByKey;
  }

  console.log("[UTM-DEBUG] leadRows fetched:", leadRows.length);
  console.log(
    "[UTM-DEBUG] raw intake fields of first 20 leads:",
    JSON.stringify((leadRows as unknown[]).slice(0, 20))
  );

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

  console.log("[UTM-DEBUG] computed countByKey:", JSON.stringify(Array.from(countByKey.entries())));

  return countByKey;
}
