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

export interface GetDailyCapStatusOptions {
  /**
   * OUTREACH-PHASE2-BRIEF.md §3.1/§5.3: drip (sequence auto-send) gets
   * priority over blasts for the shared daily_send_cap — an enrolled lead's
   * cadence is a standing commitment to one person, a blast can afford to
   * throttle/resume across days without breaking anyone's cadence. Inngest
   * gives no ordering guarantee between the two independently-triggered
   * workers (email-blast-send.ts and sequence-step-send.ts), so instead of
   * relying on run order, the blast caller pre-reserves capacity: it asks
   * for `remaining` MINUS however many auto-send drip steps are due right
   * now, so a same-day blast batch never eats into a cadence's headroom.
   * The drip worker itself calls this with no options and always sees the
   * FULL remaining — it never needs to reserve against itself.
   *
   * This is a conservative snapshot (due-now count, not a hold/lock), so
   * under real concurrent execution the two workers can still race by a few
   * units — acceptable here because the loser only sees its send throttled
   * to 'pending'/'queued' (never dropped), same as any other cap hit.
   */
  reserveForDrip?: boolean;
}

async function countDueAutoSendDraftsForTenant(db: ScopedClient): Promise<number> {
  const { data: autoSendSequences } = await db.from("email_sequences").select("id").eq("auto_send", true);
  const sequenceIds = ((autoSendSequences ?? []) as unknown as { id: string }[]).map((s) => s.id);
  if (sequenceIds.length === 0) return 0;

  const { data: enrollments } = await db
    .from("sequence_enrollments")
    .select("id")
    .in("sequence_id", sequenceIds)
    .eq("status", "active");
  const enrollmentIds = ((enrollments ?? []) as unknown as { id: string }[]).map((e) => e.id);
  if (enrollmentIds.length === 0) return 0;

  const { count } = await db
    .from("sequence_step_drafts")
    .select("id", { count: "exact", head: true })
    .eq("status", "pending")
    .lte("due_at", new Date().toISOString())
    .in("enrollment_id", enrollmentIds);

  return count ?? 0;
}

export async function getDailyCapStatus(db: ScopedClient, opts: GetDailyCapStatusOptions = {}): Promise<DailyCapStatus> {
  const { data: settingsRow } = await db.from("tenant_email_settings").select("daily_send_cap").maybeSingle();
  const dailyCap = (settingsRow as { daily_send_cap?: number } | null)?.daily_send_cap ?? DEFAULT_DAILY_CAP;

  const todayStart = new Date();
  todayStart.setUTCHours(0, 0, 0, 0);
  const { count: sentToday } = await db
    .from("email_messages")
    .select("id", { count: "exact", head: true })
    .eq("status", "sent")
    .gte("sent_at", todayStart.toISOString());

  let remaining = Math.max(0, dailyCap - (sentToday ?? 0));

  if (opts.reserveForDrip) {
    const reserved = await countDueAutoSendDraftsForTenant(db);
    remaining = Math.max(0, remaining - reserved);
  }

  return { dailyCap, sentToday: sentToday ?? 0, remaining };
}
