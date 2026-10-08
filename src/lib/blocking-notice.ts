/**
 * "Blocking notices": warnings where the system REFUSES an action because a rule isn't met and the
 * user has to do something. They are shown as a large pop-up that must be dismissed, instead of a
 * small toast that fades (which is easy to miss — a client reported exactly that).
 *
 * Which server errors count is decided in ONE place, BLOCKING_ERROR_CODES. Anything not listed
 * keeps the normal toast, so the hundreds of routine "failed to save" messages are unaffected.
 * To promote another warning to a pop-up, add its error code here.
 */

export interface ApiErrorLike {
  code?: string | null;
  message?: string | null;
}

export interface BlockingNotice {
  title: string;
  message: string;
  /** Things the user must fix (e.g. the missing pieces of a student profile). */
  items?: { label: string; hint?: string }[];
}

export type ClassifiedError =
  | { kind: "blocking"; notice: BlockingNotice }
  | { kind: "toast"; message: string };

import { CONSENT_FIELD_HINTS } from "@/lib/consent/field-hints";

/** Where to fix each piece of a student's profile (matches src/lib/leads/profile-completeness.ts). */
const MISSING_ITEM_HINTS: Record<string, string> = {
  Name: "Add it with the Edit button at the top of the student's page.",
  Email: "Add it with the Edit button at the top of the student's page.",
  Phone: "Add it with the Edit button at the top of the student's page.",
  "Study Information": "Set Field of Study and Degree Level in Study Interest (Edit → Student Details).",
  "a document": "Upload one in the Documents card on the student's page.",
};

/** "Complete the student profile … Missing: Name, Email, a document" → ["Name", "Email", "a document"]. */
export function parseMissingItems(message: string | null | undefined): string[] {
  if (!message) return [];
  const match = message.match(/Missing:\s*(.+)$/i);
  if (!match) return [];
  return match[1]
    .split(",")
    .map((part) => part.trim().replace(/\.$/, ""))
    .filter(Boolean);
}

export function profileIncompleteNotice(missing: string[]): BlockingNotice {
  return {
    title: "Complete the student profile first",
    message: "An application can only be created once the student profile is complete. Please fix the items below, then try again.",
    items: missing.map((label) => ({ label, hint: MISSING_ITEM_HINTS[label] })),
  };
}

/** Server error text for a consent blocked by an incomplete profile (parsed back by parseMissingItems). */
export function consentProfileIncompleteMessage(missing: string[]): string {
  return `Complete the student profile first. A half-filled profile makes a consent document with blank details. Missing: ${missing.join(", ")}`;
}

export function consentProfileIncompleteNotice(missing: string[]): BlockingNotice {
  return {
    title: "Complete the student profile first",
    message:
      "The consent document uses these details, and a half-filled profile sends it out with blanks. Add them in Student Details (Edit), then try again.",
    items: missing.map((label) => ({ label, hint: CONSENT_FIELD_HINTS[label] })),
  };
}

const BLOCKING_ERROR_CODES: Record<string, (error: ApiErrorLike) => BlockingNotice> = {
  PROFILE_INCOMPLETE: (error) => profileIncompleteNotice(parseMissingItems(error.message)),
  PROFILE_INCOMPLETE_FOR_CONSENT: (error) => consentProfileIncompleteNotice(parseMissingItems(error.message)),
  CONSENT_REQUIRED: () => ({
    title: "Complete the consent form first",
    message: "An application can only be created once the student's consent is signed. Use the Pre Application card to send or record the consent, then try again.",
  }),
  ALREADY_SIGNED: () => ({
    title: "Consent is already signed",
    message: "This student has already signed the consent, so there is nothing more to send. The page has been refreshed to show the signed consent.",
  }),
};

/** Decides how a server error is shown: a big pop-up for rule-blocking codes, otherwise a normal toast. */
export function classifyApiError(error: ApiErrorLike | null | undefined, fallbackMessage = "Something went wrong"): ClassifiedError {
  const code = error?.code ?? undefined;
  const build = code ? BLOCKING_ERROR_CODES[code] : undefined;
  if (build) return { kind: "blocking", notice: build(error ?? {}) };
  return { kind: "toast", message: error?.message?.trim() || fallbackMessage };
}
