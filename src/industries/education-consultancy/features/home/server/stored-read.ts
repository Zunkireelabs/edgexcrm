import type { ScopedClient } from "@/lib/supabase/scoped";
import type { ReadPoint, ReadScope } from "../lib/orca-read";

export interface StoredRead {
  points: ReadPoint[];
  madeAt: string;
  refreshes: number;
  feedback: 1 | -1 | null;
}

export interface StoredRead {
  points: ReadPoint[];
  madeAt: string;
  refreshes: number;
  feedback: 1 | -1 | null;
}

export async function loadStoredRead(db: ScopedClient, userId: string, scope: ReadScope, forDate: string): Promise<StoredRead | null> {
  const { data } = await db.from("home_reads").select("points, made_at, refreshes, feedback").eq("user_id", userId).eq("scope", scope).eq("for_date", forDate).maybeSingle();
  const r = data as unknown as { points: ReadPoint[]; made_at: string; refreshes: number; feedback: number | null } | null;
  if (!r) return null;
  return { points: Array.isArray(r.points) ? r.points : [], madeAt: r.made_at, refreshes: r.refreshes, feedback: r.feedback === 1 || r.feedback === -1 ? r.feedback : null };
}

