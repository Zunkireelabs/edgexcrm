import type { ScopedClient } from "@/lib/supabase/scoped";

// Single source of truth for "how much of today's daily_send_cap is left" —
// used by sendQueuedEmailBatch (the enforcement point) AND by the blast
// /preview route (OUTREACH-PHASE1-BRIEF.md §6: the composer must show the
// shortfall in numbers before the send button is reachable, not discover it
// after /send). Two callers computing this independently is how they drift;
// this is the one place the math lives.

const DEFAULT_DAILY_CAP = 2000;

export interface DailyCapStatus {
  dailyCap: number;
  sentToday: number;
  remaining: number;
}

export async function getDailyCapStatus(db: ScopedClient): Promise<DailyCapStatus> {
  const { data: settingsRow } = await db.from("tenant_email_settings").select("daily_send_cap").maybeSingle();
  const dailyCap = (settingsRow as { daily_send_cap?: number } | null)?.daily_send_cap ?? DEFAULT_DAILY_CAP;

  const todayStart = new Date();
  todayStart.setUTCHours(0, 0, 0, 0);
  const { count: sentToday } = await db
    .from("email_messages")
    .select("id", { count: "exact", head: true })
    .eq("status", "sent")
    .gte("sent_at", todayStart.toISOString());

  const remaining = Math.max(0, dailyCap - (sentToday ?? 0));
  return { dailyCap, sentToday: sentToday ?? 0, remaining };
}
