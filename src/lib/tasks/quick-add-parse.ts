// Round 2 slice E — capture at the speed of WhatsApp
// (docs/IT-AGENCY-ROUND2-SLICE-E-CAPTURE-BRIEF.md §3.1). Pure, client-safe
// parsing helpers for the ⌘K quick-add row: pulling a trailing @mention out
// of the typed query, matching it against the team roster, and turning a
// multi-line paste into a batch of task titles. No imports from server code
// so these can run in both the palette component and its unit tests without
// any mocking.

export interface RosterMember {
  user_id: string;
  name: string;
}

/**
 * Pulls a trailing "@token" off the end of a query. Only a mention at the
 * very end counts — an "@" earlier in the string (e.g. inside an email
 * address, or followed by more text) is left untouched in the title, because
 * it isn't a boundary-anchored trailing token.
 *
 * "Fix login copy @hard" -> { title: "Fix login copy", mentionToken: "hard" }
 * "Email steve@example.com" -> { title: "Email steve@example.com", mentionToken: null }
 * "Email steve@example.com @hardik" -> { title: "Email steve@example.com", mentionToken: "hardik" }
 */
export function extractMention(query: string): { title: string; mentionToken: string | null } {
  const trimmed = query.trim();
  const match = trimmed.match(/(^|\s)@(\S*)$/);
  if (!match) return { title: trimmed, mentionToken: null };

  const token = match[2];
  const title = trimmed.slice(0, trimmed.length - match[0].length).trim();
  return { title, mentionToken: token.length > 0 ? token : null };
}

/**
 * Case-insensitive: a member matches if any word of their name starts with
 * the token. Returns all matches, capped at 5, in stable order by name.
 */
export function matchMembers(token: string, roster: RosterMember[]): RosterMember[] {
  const t = token.trim().toLowerCase();
  if (!t) return [];

  return roster
    .filter((m) => m.name.toLowerCase().split(/\s+/).some((word) => word.startsWith(t)))
    .sort((a, b) => a.name.localeCompare(b.name))
    .slice(0, 5);
}

const PASTE_LINE_PREFIX_RE = /^(?:[-*•]\s+|\d+[.)]\s+|\[[ xX]\]\s+)/;
const MAX_PASTED_TITLES = 25;
const MAX_TITLE_LENGTH = 255;

/**
 * Splits pasted text into task titles: one non-empty line -> one title.
 * Strips common list prefixes (bullets, numbering, checkboxes), trims, drops
 * empty lines, and truncates each title to 255 chars. Caps the result at 25
 * titles and reports whether more were dropped.
 */
export function parsePastedLines(text: string): { titles: string[]; truncated: boolean } {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.replace(PASTE_LINE_PREFIX_RE, "").trim())
    .filter((line) => line.length > 0)
    .map((line) => line.slice(0, MAX_TITLE_LENGTH));

  return {
    titles: lines.slice(0, MAX_PASTED_TITLES),
    truncated: lines.length > MAX_PASTED_TITLES,
  };
}
