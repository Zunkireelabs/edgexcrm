import type { DoNextItem } from "./types";
import { draftLabel } from "./draft";

/** B5 (H3b): "Prepare all". One request drafts every message the row buttons could, at most this many. */
export const BATCH_MAX = 12;

/** Row kinds a batch can draft. Grouped rows contribute their real leads; the group row itself is never a message. */
export type BatchKind = "reply_waiting" | "deadline_docs" | "callback_overdue" | "going_quiet";
export const BATCH_KINDS: readonly BatchKind[] = ["reply_waiting", "deadline_docs", "callback_overdue", "going_quiet"];

export interface BatchEntry {
  leadId: string;
  kind: BatchKind;
  name: string;
  /** The small grey bit on the card: "9 days quiet", "Replied 2 h ago". */
  label: string;
}

const isBatchKind = (k: string): k is BatchKind => (BATCH_KINDS as readonly string[]).includes(k);

/**
 * The messages "Prepare all" would write, in the order they appear on Home, one per lead (the first row for a lead wins):
 *   - a row B3 can draft (reply, missing document, overdue call-back), and
 *   - the real leads inside a grouped row (going quiet, missed call-backs), so "Draft check-ins" is the same batch.
 * Hidden (snoozed / done) rows are left out. The count on the card is the length of this list, capped at BATCH_MAX.
 */
export function batchEntries(items: DoNextItem[], hidden: ReadonlySet<string> = new Set()): { entries: BatchEntry[]; total: number } {
  const seen = new Set<string>();
  const all: BatchEntry[] = [];
  const add = (i: DoNextItem) => {
    if (hidden.has(i.key) || !i.leadId || !isBatchKind(i.kind) || seen.has(i.leadId)) return;
    seen.add(i.leadId);
    all.push({ leadId: i.leadId, kind: i.kind, name: i.primaryAction.type === "call" ? i.primaryAction.leadName : i.title, label: i.chip.text });
  };
  for (const i of items) {
    if (hidden.has(i.key)) continue;
    if ((i.children?.length ?? 0) > 0) {
      for (const c of i.children ?? []) add(c);
    } else if (draftLabel(i)) add(i);
  }
  return { entries: all.slice(0, BATCH_MAX), total: all.length };
}

const SUMMARY_ORDER: readonly BatchKind[] = ["going_quiet", "deadline_docs", "reply_waiting", "callback_overdue"];
const NOUN: Record<BatchKind, [string, string]> = {
  going_quiet: ["check-in", "check-ins"],
  deadline_docs: ["document request", "document requests"],
  reply_waiting: ["reply", "replies"],
  callback_overdue: ["call-back follow-up", "call-back follow-ups"],
};

/** "4 check-ins, 1 document request, 1 reply": the card's second line. */
export function batchSummary(entries: Pick<BatchEntry, "kind">[]): string {
  const n = new Map<BatchKind, number>();
  for (const e of entries) n.set(e.kind, (n.get(e.kind) ?? 0) + 1);
  return SUMMARY_ORDER.filter((k) => n.has(k)).map((k) => `${n.get(k)} ${NOUN[k][n.get(k) === 1 ? 0 : 1]}`).join(", ");
}

/**
 * P3: the chip under the title says only what is TRUE of this batch: "On WhatsApp" when every card is WhatsApp, "On email" when every
 * card is email, else "WhatsApp and email". Cards with no way to send don't count. Null when nothing can be sent.
 */
export function channelChip(channels: Array<"whatsapp" | "email" | null>): string | null {
  const used = new Set(channels.filter((c): c is "whatsapp" | "email" => c !== null));
  if (used.size === 0) return null;
  return used.size === 2 ? "WhatsApp and email" : used.has("whatsapp") ? "On WhatsApp" : "On email";
}
