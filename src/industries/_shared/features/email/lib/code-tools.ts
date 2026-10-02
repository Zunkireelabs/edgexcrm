// Pure helpers behind the HTML source editor's code tools (find, go-to-line, file drop).
// Kept free of React/DOM so they can be unit-tested directly.

export const MAX_HTML_FILE_BYTES = 1024 * 1024; // 1 MB — an email body, not an asset upload

/** Start indices of every non-overlapping, case-insensitive match of `query` in `text`. */
export function findMatches(text: string, query: string): number[] {
  if (!query) return [];
  const hay = text.toLowerCase();
  const needle = query.toLowerCase();
  const out: number[] = [];
  let from = 0;
  for (;;) {
    const at = hay.indexOf(needle, from);
    if (at === -1) return out;
    out.push(at);
    from = at + needle.length;
  }
}

/** 1-based line number containing character `index`. */
export function lineOfIndex(text: string, index: number): number {
  let line = 1;
  const end = Math.min(Math.max(index, 0), text.length);
  for (let i = 0; i < end; i++) if (text.charCodeAt(i) === 10) line++;
  return line;
}

export function lineCount(text: string): number {
  let n = 1;
  for (let i = 0; i < text.length; i++) if (text.charCodeAt(i) === 10) n++;
  return n;
}

/** Character index where 1-based `line` starts (clamped to the first/last line). */
export function indexOfLine(text: string, line: number): number {
  const target = Math.min(Math.max(Math.floor(line), 1), lineCount(text));
  let current = 1;
  for (let i = 0; i < text.length && current < target; i++) {
    if (text.charCodeAt(i) === 10) {
      current++;
      if (current === target) return i + 1;
    }
  }
  return 0;
}

/** Returns an error message for a dropped/picked file, or null when it is an acceptable HTML file. */
export function validateHtmlFile(file: { name: string; size: number }): string | null {
  if (!/\.html?$/i.test(file.name)) return "Only .html or .htm files can be loaded";
  if (file.size === 0) return "That file is empty";
  if (file.size > MAX_HTML_FILE_BYTES) return "That file is over 1 MB — an email body should be smaller";
  return null;
}
