/**
 * What may never reach a model prompt (EDGEX-87 Part B, D3): phone numbers, email addresses, passport numbers, document
 * links. Names, intake, course, notes and stage are fine. Every Home prompt builder passes its free text through
 * stripPrivate, and privacy.test.ts asserts it.
 */
const EMAIL = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
const URL_LIKE = /\b(?:https?:\/\/|www\.)\S+|\b\S+\.(?:pdf|docx?|jpe?g|png|heic)\b/gi;
// 7+ digits, optionally with spaces, dashes, dots, parentheses and a leading +: a phone number.
const PHONE = /(?<![\w.])\+?\(?\d[\d\s().-]{5,}\d(?![\w])/g;
// A passport number: after the word "passport", the next token with at least one digit.
const PASSPORT = /\b(passport(?:\s*(?:no|number|num|#))?\.?\s*[:\-]?\s*)([A-Z]{0,2}\d[A-Z0-9-]{4,})/gi;
// A bare passport-shaped token: 1-2 letters then 6-8 digits (e.g. PA1234567).
const PASSPORT_SHAPE = /\b[A-Z]{1,2}\d{6,8}\b/g;

export function stripPrivate(text: string): string {
  return text
    .replace(EMAIL, "[email removed]")
    .replace(URL_LIKE, "[link removed]")
    .replace(PASSPORT, "$1[removed]")
    .replace(PASSPORT_SHAPE, "[passport removed]")
    .replace(PHONE, (m) => (m.replace(/\D/g, "").length >= 7 ? "[phone removed]" : m));
}
