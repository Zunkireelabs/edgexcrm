import type { LeadUtmRow } from "@/lib/supabase/queries";

export type UtmField = "intake_source" | "intake_medium" | "intake_campaign";

export interface UtmBucket {
  name: string;
  count: number;
  otherNames?: string[];
}

const TOP_N = 8;

export function groupByUtmField(
  leads: LeadUtmRow[],
  field: UtmField,
): UtmBucket[] {
  const counts: Record<string, number> = {};
  for (const lead of leads) {
    const raw = lead[field];
    if (!raw || typeof raw !== "string") continue;
    const trimmed = raw.trim();
    if (!trimmed) continue;
    counts[trimmed] = (counts[trimmed] || 0) + 1;
  }

  const sorted = Object.entries(counts)
    .map(([name, count]) => ({ name, count }))
    .sort((a, b) => b.count - a.count);

  if (sorted.length <= TOP_N) return sorted;

  const top = sorted.slice(0, TOP_N);
  const rest = sorted.slice(TOP_N);
  const otherCount = rest.reduce((sum, b) => sum + b.count, 0);
  if (otherCount > 0) {
    top.push({ name: "Other", count: otherCount, otherNames: rest.map((b) => b.name) });
  }
  return top;
}
