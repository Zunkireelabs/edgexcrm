/** Sentence case for the role chip: capitalise only the first letter, leave the rest as written. Never CSS `capitalize`. */
export function sentenceCase(s: string): string {
  const t = s.trim();
  return t ? t.charAt(0).toUpperCase() + t.slice(1) : t;
}

/** "Owner · All branches", "Counselor · Kathmandu". */
export function roleChipText(role: string, branch: string): string {
  return `${sentenceCase(role)} · ${branch}`;
}
