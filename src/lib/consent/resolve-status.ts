/**
 * The one definition of "is this lead's consent signed?" for the consent status API.
 *
 * The lead page and both Applications APIs already treat a lead as consented when ANY
 * non-deleted consent row is `signed`. This status route used to look only at the NEWEST row,
 * so a newer `sent`/`expired` row created next to a signed one (a resend racing the student
 * signing, a second tab, an abandoned in-person session) made the consent card report "not
 * signed" and disabled "+ Add application" even though the server would have accepted it.
 * Both now share this rule.
 */

export type ConsentStatus = "none" | "sent" | "signed" | "expired";

export interface ConsentRecordRow {
  id: string;
  status: string;
  method: string | null;
  token: string | null;
  signer_name: string | null;
  signed_at: string | null;
  document_url: string | null;
  link_expires_at: string | null;
  sent_at: string | null;
  sent_via: string | null;
}

export interface ResolvedConsent {
  status: ConsentStatus;
  /** The record the status is derived from (newest signed one when signed), or null. */
  record: ConsentRecordRow | null;
}

/**
 * @param records the lead's non-deleted consent rows, NEWEST FIRST.
 * @param now injectable clock so link expiry is testable.
 */
export function resolveConsentStatus(records: ConsentRecordRow[], now: Date = new Date()): ResolvedConsent {
  // Any signed record means the lead has consented; a later unsigned row must not undo that.
  const signed = records.find((r) => r.status === "signed");
  if (signed) return { status: "signed", record: signed };

  const latest = records[0] ?? null;
  if (!latest) return { status: "none", record: null };

  if (latest.status === "sent") {
    if (latest.link_expires_at && new Date(latest.link_expires_at) < now) {
      return { status: "expired", record: latest };
    }
    return { status: "sent", record: latest };
  }

  // Any other status on the newest row (nothing signed anywhere): behaves as before.
  return { status: "none", record: latest };
}
