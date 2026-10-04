import type { AuthContext } from "@/lib/api/auth";
import type { ScopedClient } from "@/lib/supabase/scoped";
import { buildDraftsQuery, cleanUuid } from "./draft-scope";
import { BULK_DRAFT_MAX, SKIP_BATCH, BULK_DRAFT_CONFIRM_FROM } from "./bulk-draft-constants";

// Bulk actions on drafts in Outreach -> Today (Phase 6): Send now / Schedule / Skip for many drafts at once.
//
//   send      sets scheduled_send_at = now on every eligible draft; the scheduled-send timer then sends them (cap-aware,
//             restart-safe) over the next minutes. Doing the sends inside the request would hold it open for thousands of
//             provider calls — the timer is the one place that already does this safely.
//   schedule  the same, at a chosen time.
//   skip      skips the drafts (each skip advances its sequence, so it runs in batches the screen repeats until done).
//
// WHICH drafts is decided by draft-scope.ts — the same rules as the list — so "select all 1,234" can never act on a
// different set than the list shows, and a counselor can only ever touch their own.

export { BULK_DRAFT_MAX, SKIP_BATCH, BULK_DRAFT_CONFIRM_FROM };

const MIN_LEAD_MS = 5 * 60 * 1000;
const MAX_LEAD_MS = 90 * 24 * 60 * 60 * 1000;
const IDS_PER_QUERY = 100;
const PAGE = 1000;

export type BulkDraftAction = "send" | "schedule" | "skip";

export type BulkDraftSelection =
  | { mode: "ids"; ids: string[] }
  | { mode: "all"; due: "today" | "all"; assignedTo: string | null };

export interface ParsedBulkDraftBody {
  action: BulkDraftAction;
  selection: BulkDraftSelection;
  sendAt: Date | null;
  confirm: boolean;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function parseBulkDraftBody(
  body: Record<string, unknown>
): { ok: true; value: ParsedBulkDraftBody } | { ok: false; status: number; code: string; message: string; errors?: Record<string, string[]> } {
  const action = body.action;
  if (action !== "send" && action !== "schedule" && action !== "skip") {
    return { ok: false, status: 422, code: "VALIDATION", message: "action must be send, schedule or skip", errors: { action: ["Must be one of: send, schedule, skip"] } };
  }

  const sel = body.selection as Record<string, unknown> | undefined;
  let selection: BulkDraftSelection;
  if (sel?.mode === "ids") {
    const ids = sel.ids;
    if (!Array.isArray(ids) || ids.length === 0 || !ids.every((i) => typeof i === "string" && UUID_RE.test(i))) {
      return { ok: false, status: 422, code: "VALIDATION", message: "selection.ids must be a non-empty list of ids", errors: { selection: ["Pick at least one draft."] } };
    }
    if (ids.length > BULK_DRAFT_MAX) {
      return { ok: false, status: 422, code: "VALIDATION", message: "too many drafts", errors: { selection: [`At most ${BULK_DRAFT_MAX} drafts at a time.`] } };
    }
    selection = { mode: "ids", ids: [...new Set(ids as string[])] };
  } else if (sel?.mode === "all") {
    selection = { mode: "all", due: sel.due === "today" ? "today" : "all", assignedTo: cleanUuid(typeof sel.assigned_to === "string" ? sel.assigned_to : null) };
  } else {
    return { ok: false, status: 422, code: "VALIDATION", message: 'selection.mode must be "ids" or "all"', errors: { selection: ['Choose drafts: mode must be "ids" or "all".'] } };
  }

  let sendAt: Date | null = null;
  if (action === "schedule") {
    sendAt = typeof body.send_at === "string" ? new Date(body.send_at) : null;
    if (!sendAt || Number.isNaN(sendAt.getTime())) {
      return { ok: false, status: 422, code: "VALIDATION", message: "A valid date and time is required", errors: { send_at: ["A valid date and time is required"] } };
    }
    const delta = sendAt.getTime() - Date.now();
    if (delta < MIN_LEAD_MS) return { ok: false, status: 422, code: "SCHEDULE_TOO_SOON", message: "Pick a time at least 5 minutes from now." };
    if (delta > MAX_LEAD_MS) return { ok: false, status: 422, code: "SCHEDULE_TOO_FAR", message: "Pick a time within the next 90 days." };
  }

  return { ok: true, value: { action, selection, sendAt, confirm: body.confirm === true } };
}

export interface EligibleDraft {
  id: string;
  subject: string;
  leads: { email: string | null } | null;
}

export interface Eligibility {
  /** Drafts that can be acted on, in due order (capped at `limit`). */
  eligible: EligibleDraft[];
  /** How many drafts matched the selection in all (before the cap and the sending checks). */
  matched: number;
  /** Matched drafts that can't be sent: no subject, or the lead has no email. (Skip ignores these.) */
  skipped: { noSubject: number; noEmail: number };
  /** Ids asked for that are not available to this person (not theirs, no longer pending, lead deleted, enrollment paused…). Ids mode only. */
  notAvailable: number;
  /** There were more matches than `limit`. */
  truncated: boolean;
}

const ELIGIBLE_SELECT = "id, subject, leads!inner(email), sequence_enrollments!inner(status)";

/**
 * The drafts a bulk action would act on. For send / schedule (`forSending`) a draft with no subject or whose lead has no
 * email is left out and counted; for skip they are fine. Never returns more than `limit`.
 */
export async function resolveEligibleDrafts(
  db: ScopedClient,
  auth: AuthContext,
  selection: BulkDraftSelection,
  opts: { forSending: boolean; limit: number }
): Promise<Eligibility> {
  const found: EligibleDraft[] = [];
  let notAvailable = 0;
  let truncated = false;
  let matched = 0;

  if (selection.mode === "ids") {
    for (let i = 0; i < selection.ids.length; i += IDS_PER_QUERY) {
      const chunk = selection.ids.slice(i, i + IDS_PER_QUERY);
      const { data, error } = await buildDraftsQuery(db, auth, { due: "all" }, ELIGIBLE_SELECT).in("id", chunk);
      if (error) throw new Error(`bulk drafts: ${error.message}`);
      const rows = (data ?? []) as unknown as EligibleDraft[];
      found.push(...rows);
      notAvailable += chunk.length - rows.length;
    }
    matched = found.length;
  } else {
    const filters = { due: selection.due, assignedTo: selection.assignedTo } as const;
    const { count } = await buildDraftsQuery(db, auth, filters, ELIGIBLE_SELECT, { count: "exact", head: true });
    matched = count ?? 0;
    for (let from = 0; from < Math.min(matched, opts.limit + 1); from += PAGE) {
      const { data, error } = await buildDraftsQuery(db, auth, filters, ELIGIBLE_SELECT)
        .order("due_at", { ascending: true })
        .order("id", { ascending: true })
        .range(from, from + PAGE - 1);
      if (error) throw new Error(`bulk drafts: ${error.message}`);
      found.push(...((data ?? []) as unknown as EligibleDraft[]));
      if ((data ?? []).length < PAGE) break;
    }
  }

  const skipped = { noSubject: 0, noEmail: 0 };
  let eligible: EligibleDraft[] = [];
  for (const d of found) {
    if (opts.forSending) {
      if (!d.subject?.trim()) {
        skipped.noSubject++;
        continue;
      }
      if (!d.leads?.email?.trim()) {
        skipped.noEmail++;
        continue;
      }
    }
    eligible.push(d);
  }
  if (eligible.length > opts.limit) {
    truncated = true;
    eligible = eligible.slice(0, opts.limit);
  }
  return { eligible, matched, skipped, notAvailable, truncated };
}

/** Marks drafts to be sent by the scheduled-send timer at `sendAt` (now for "Send now"). Returns how many were updated. */
export async function scheduleDrafts(db: ScopedClient, auth: Pick<AuthContext, "userId">, ids: string[], sendAt: Date): Promise<number> {
  let updated = 0;
  for (let i = 0; i < ids.length; i += 200) {
    const chunk = ids.slice(i, i + 200);
    const { data, error } = await db
      .from("sequence_step_drafts")
      .update({ scheduled_send_at: sendAt.toISOString(), scheduled_by: auth.userId, scheduled_error: null })
      .in("id", chunk)
      .eq("status", "pending")
      .select("id");
    if (error) throw new Error(`bulk drafts: ${error.message}`);
    updated += (data ?? []).length;
  }
  return updated;
}
