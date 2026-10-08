import type { FormSmsAutoresponder } from "@/types/database";

// Pure (no I/O) so the PATCH route, the builder and the tests all share one definition of what a
// stored confirmation-SMS config may look like.

// The body is the part the admin writes; sender label and opt-out link are added on top at send
// time. ~3 GSM-7 segments of admin text keeps one confirmation from costing more than 3-4 credits.
export const SMS_AUTORESPONDER_BODY_MAX = 480;

export const SMS_AUTORESPONDER_DEFAULTS: FormSmsAutoresponder = {
  enabled: false,
  fire_mode: "every",
  body: "",
};

/**
 * Merges a caller-supplied partial `sms` object onto the previously stored one, key by key — an
 * omitted key means "leave alone". Anything that is not a plain object is ignored, never stored.
 */
export function normalizeSmsAutoresponder(
  prev: Partial<FormSmsAutoresponder> | null | undefined,
  raw: unknown
): FormSmsAutoresponder {
  const base = { ...SMS_AUTORESPONDER_DEFAULTS, ...(prev ?? {}) };
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return base;
  const input = raw as Record<string, unknown>;

  return {
    enabled: input.enabled !== undefined ? Boolean(input.enabled) : base.enabled,
    fire_mode:
      input.fire_mode !== undefined ? (input.fire_mode === "first" ? "first" : "every") : base.fire_mode,
    body: typeof input.body === "string" ? input.body.slice(0, SMS_AUTORESPONDER_BODY_MAX) : base.body,
  };
}

// What a merge tag is assumed to expand to when ESTIMATING length in the builder. The real value is
// only known per lead at send time, so the counter is an estimate — but counting the raw "{{tag}}"
// text is worse: each brace costs two characters in SMS encoding and never reaches the recipient.
export const MERGE_TAG_ESTIMATE_CHARS = 10;

const MERGE_TAG_PATTERN = /\{\{\s*[a-zA-Z0-9_.]+\s*\}\}/g;

export function estimateRenderedBody(body: string): string {
  return body.replace(MERGE_TAG_PATTERN, "x".repeat(MERGE_TAG_ESTIMATE_CHARS));
}
