// Round 2 slice B — multi-line paste capture
// (docs/IT-AGENCY-ROUND2-SLICE-B-BRIEF.md §3b). Turns a block of pasted text
// into individual task titles: one non-empty line -> one task title. Strips
// common list prefixes (-, *, •, 1., 1)) because that is exactly what a paste
// out of WhatsApp or a notes app looks like. Pure function so it can be unit
// tested without touching the DOM.

const LIST_PREFIX_RE = /^(?:[-*•]|\d+[.)])\s+/;

/** Split pasted text into trimmed, prefix-stripped, non-empty task titles. */
export function parsePasteLines(text: string): string[] {
  return text
    .split(/\r\n|\r|\n/)
    .map((line) => line.trim().replace(LIST_PREFIX_RE, "").trim())
    .filter((line) => line.length > 0);
}

/**
 * True when the paste carries more than one task worth capturing — the
 * signal to offer "Create N tasks" instead of a single task with embedded
 * newlines. A paste with newlines that reduces to one non-empty line (e.g.
 * trailing blank lines) stays a single task, same as one with no newline at all.
 */
export function isMultiLinePaste(text: string): boolean {
  return /\r\n|\r|\n/.test(text) && parsePasteLines(text).length > 1;
}
