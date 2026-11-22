// "Next step · Orca" column (leads table v2 mockup, a PREVIEW): one short suggested action per lead.
//
// Rules only, no AI call and no stored value: the suggestion is worked out from facts the lead row
// already carries, so it can never go stale or disagree with the data. The first matching rule wins.
// Education-consultancy only (the column is gated in columns-registry.tsx).

import type { Lead } from "@/types/database";

export interface NextStepSuggestion {
  text: string;
  /** Something is wrong or overdue (callback due, bad email). Rendered a little heavier. */
  urgent: boolean;
}

export interface NextStepInput {
  lead: Lead;
  /** lead_lists.slug of the lead's current Stage, when known. */
  stageSlug: string | null;
  /** Tenant follow-up threshold in days (Team & Lead Performance). */
  staleDays: number;
  now?: number;
}

const DAY_MS = 1000 * 60 * 60 * 24;

// Common typos of big mail providers. Deliberately a short allow-list of KNOWN mistakes so a real,
// unusual domain is never flagged.
const MISTYPED_DOMAINS = new Set([
  "gmil.com", "gmial.com", "gamil.com", "gnail.com", "gmai.com", "gmail.co", "gmail.con", "gmaill.com",
  "yahho.com", "yaho.com", "yahoo.con", "hotmial.com", "hotmal.com", "hotmail.con", "outlok.com",
]);

export function looksMistypedEmail(email: string | null | undefined): boolean {
  const e = (email ?? "").trim().toLowerCase();
  if (!e) return false;
  const at = e.lastIndexOf("@");
  if (at <= 0 || at === e.length - 1) return true;
  const domain = e.slice(at + 1);
  return !domain.includes(".") || MISTYPED_DOMAINS.has(domain);
}

const FEE_DONE = new Set(["paid", "waiver", "claimed"]);

const has = (v: string | null | undefined) => !!v && v.trim() !== "";

export function suggestNextStep({ lead, stageSlug, staleDays, now = Date.now() }: NextStepInput): NextStepSuggestion | null {
  // Customer asked to wait: do not nag. (Same stance as the follow-up badge.)
  if (lead.on_hold) return { text: "On hold — revisit later", urgent: false };

  if (lead.callback_due_at && new Date(lead.callback_due_at).getTime() <= now) {
    return { text: "Call back — callback due", urgent: true };
  }
  if (!has(lead.email) && !has(lead.phone)) return { text: "Add contact details", urgent: true };
  if (looksMistypedEmail(lead.email)) return { text: "Fix email — looks mistyped", urgent: true };

  if (!lead.last_touched_at) return { text: "Intro call not yet booked", urgent: false };
  const daysSince = Math.floor((now - new Date(lead.last_touched_at).getTime()) / DAY_MS);
  if (daysSince >= staleDays) return { text: `Follow up — ${daysSince}d since touch`, urgent: false };

  const feeDone = FEE_DONE.has(lead.pre_app_fee_status ?? "");
  switch (stageSlug) {
    case "applications":
      if (!has(lead.passport_number)) return { text: "Collect passport + transcripts", urgent: false };
      return { text: "Chase university offer letter", urgent: false };
    case "prospects":
      if (!has(lead.degree_level) || (lead.destinations ?? []).length === 0) {
        return { text: "Qualify — confirm study level", urgent: false };
      }
      if (!feeDone) return { text: "Collect pre-application fee", urgent: false };
      return { text: "Move to Applications", urgent: false };
    case "qualified":
      if (!has(lead.degree_level) || (lead.destinations ?? []).length === 0) {
        return { text: "Qualify — confirm study level", urgent: false };
      }
      return { text: "Move to Prospects", urgent: false };
    case "pre-qualified":
      return { text: "Book counselling session", urgent: false };
    default:
      return { text: "Review lead", urgent: false };
  }
}
