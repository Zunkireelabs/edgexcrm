import type { ProviderReportRow } from "./provider/types";

// Pure delivery-report matching, split out exactly like attribute.ts (Phase 1)
// so the DB write in sms-delivery-poll.ts is a thin caller and this regression
// class — attributing the wrong report row to the wrong recipient — is unit
// testable without a database. docs/SMS-PHASE4-BRIEF.md item 1 / SMS-PHASE1-
// BRIEF.md §2: the report row's `id` has NO relationship to the send
// response's id (verified live), so matching happens on recipient + body +
// timestamp instead. Ambiguous matches are left unresolved, never guessed.

export interface CandidateMessage {
  id: string;
  to_phone: string; // bare 10-digit, as sent to the provider
  body: string; // fully rendered body, as sent
  sent_at: string; // ISO timestamp
}

export type DeliveryOutcome = "delivered" | "failed";

export interface DeliveryMatch {
  messageId: string;
  outcome: DeliveryOutcome;
  providerReportId: string;
  providerCredit: number | null;
  reportStatus: string;
}

export interface DeliveryMatchResult {
  matches: DeliveryMatch[];
  // No confident match yet (report row not seen this poll) OR genuinely
  // ambiguous (can't tell which of several identical recipient+body rows a
  // report row belongs to). Both cases are left alone; the poller retries
  // them on the next run until the attempt cap is hit.
  unresolvedMessageIds: string[];
}

const DELIVERED_STATUSES = new Set(["delivered", "success", "sent", "received"]);
const FAILED_STATUSES = new Set(["failed", "undelivered", "rejected", "expired", "error"]);

// Aakash echoes mobiles back in whatever shape it feels like (observed with
// dial-code prefixes and stray whitespace in Phase 1) — normalize both sides
// to their last 10 digits before comparing, same as attribute.ts.
function normalizeMobile(mobile: string): string {
  return mobile.replace(/\D/g, "").slice(-10);
}

function parseCredit(raw: unknown): number | null {
  // credit comes back as a STRING (docs/SMS-PHASE1-BRIEF.md §2) — never trust
  // its runtime type.
  if (typeof raw === "number" && Number.isFinite(raw)) return raw;
  if (typeof raw === "string") {
    const n = Number(raw);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

// updated_at can be the MySQL zero-date sentinel "0000-00-00 00:00:00", which
// is not a valid date. Never feed it to `new Date()` unguarded.
function parseReportTimestamp(raw: unknown): number | null {
  if (typeof raw !== "string") return null;
  if (/^0{4}-0{2}-0{2}/.test(raw)) return null;
  // "YYYY-MM-DD HH:MM:SS" with no timezone offset would otherwise be parsed
  // in the RUNTIME's local timezone by `new Date()`, while sent_at is stored
  // (and compared) as UTC ISO — a silent, environment-dependent skew that
  // would misorder the nearest-timestamp disambiguation below. Force UTC so
  // both sides of the comparison share one reference frame.
  const normalized = /[Zz]|[+-]\d\d:?\d\d$/.test(raw) ? raw : `${raw.replace(" ", "T")}Z`;
  const t = new Date(normalized).getTime();
  return Number.isFinite(t) ? t : null;
}

function classifyStatus(status: string): DeliveryOutcome | null {
  const s = status.trim().toLowerCase();
  if (DELIVERED_STATUSES.has(s)) return "delivered";
  if (FAILED_STATUSES.has(s)) return "failed";
  return null; // still in-transit / unrecognized provider status — not terminal yet
}

export function matchDeliveryReports(
  candidates: CandidateMessage[],
  reportRows: ProviderReportRow[]
): DeliveryMatchResult {
  // Dedup by report id — a poll window can legitimately re-return the same
  // row across consecutive runs.
  const seenReportIds = new Set<string>();
  const dedupedRows: ProviderReportRow[] = [];
  for (const row of reportRows) {
    const rid = row.id != null ? String(row.id) : "";
    if (rid) {
      if (seenReportIds.has(rid)) continue;
      seenReportIds.add(rid);
    }
    dedupedRows.push(row);
  }

  // key = normalized mobile + rendered body. Both sides must carry a body to
  // build a key — a report row missing `message` can never be matched, and
  // stays available for a later pass once we understand its real shape.
  const rowsByKey = new Map<string, ProviderReportRow[]>();
  for (const row of dedupedRows) {
    if (typeof row.mobile !== "string" || typeof row.message !== "string") continue;
    const key = `${normalizeMobile(row.mobile)}|${row.message}`;
    const list = rowsByKey.get(key) ?? [];
    list.push(row);
    rowsByKey.set(key, list);
  }

  const candidatesByKey = new Map<string, CandidateMessage[]>();
  for (const c of candidates) {
    const key = `${normalizeMobile(c.to_phone)}|${c.body}`;
    const list = candidatesByKey.get(key) ?? [];
    list.push(c);
    candidatesByKey.set(key, list);
  }

  const matches: DeliveryMatch[] = [];
  const unresolved = new Set(candidates.map((c) => c.id));

  function recordMatch(candidateId: string, row: ProviderReportRow): void {
    const outcome = classifyStatus(row.status);
    if (!outcome) return; // in-transit — leave unresolved for the next poll
    matches.push({
      messageId: candidateId,
      outcome,
      providerReportId: String(row.id),
      providerCredit: parseCredit(row.credit),
      reportStatus: row.status,
    });
    unresolved.delete(candidateId);
  }

  for (const [key, cands] of candidatesByKey) {
    const rows = rowsByKey.get(key) ?? [];
    if (rows.length === 0) continue; // no report row yet

    if (cands.length === 1 && rows.length === 1) {
      recordMatch(cands[0].id, rows[0]);
      continue;
    }

    // Ambiguous: several candidates and/or report rows share the identical
    // recipient+body key (e.g. the same boilerplate text sent twice to the
    // same number within the poll window). Only disambiguate when every
    // candidate has an equal count of rows AND every pairing can be resolved
    // by strictly-nearest sent_at <-> updated_at timestamp with no ties —
    // otherwise leave the WHOLE group unresolved rather than guess.
    if (cands.length !== rows.length) continue;

    const pairs: { candId: string; row: ProviderReportRow; delta: number }[] = [];
    let allTimestamped = true;
    for (const c of cands) {
      const ct = new Date(c.sent_at).getTime();
      if (!Number.isFinite(ct)) {
        allTimestamped = false;
        break;
      }
      for (const r of rows) {
        const rt = parseReportTimestamp(r.updated_at);
        if (rt === null) {
          allTimestamped = false;
          break;
        }
        pairs.push({ candId: c.id, row: r, delta: Math.abs(ct - rt) });
      }
      if (!allTimestamped) break;
    }
    if (!allTimestamped) continue;

    pairs.sort((a, b) => a.delta - b.delta);
    const usedCandidates = new Set<string>();
    const usedRows = new Set<ProviderReportRow>();
    const assigned: typeof pairs = [];
    let tie = false;
    for (let i = 0; i < pairs.length; i++) {
      const p = pairs[i];
      if (usedCandidates.has(p.candId) || usedRows.has(p.row)) continue;
      const next = pairs[i + 1];
      if (next && next.delta === p.delta && !usedCandidates.has(next.candId) && !usedRows.has(next.row)) {
        tie = true;
        break;
      }
      usedCandidates.add(p.candId);
      usedRows.add(p.row);
      assigned.push(p);
    }
    if (tie || assigned.length !== cands.length) continue;

    for (const p of assigned) recordMatch(p.candId, p.row);
  }

  return { matches, unresolvedMessageIds: Array.from(unresolved) };
}
