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

  if (error || !leadRows) {
    console.error("computeSubmissionCounts: leads query failed", error);
    return countByKey;
  }

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

  return countByKey;
}
