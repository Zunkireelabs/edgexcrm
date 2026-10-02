// Small joiners that stay lowercase inside a name ("Republic of Ireland").
const JOINERS = new Set(["of", "and", "the", "de", "da", "del", "la", "van", "von"]);

/**
 * Display-only tidy-up for values typed in lowercase ("nepal" → "Nepal"). Only words that are
 * entirely lowercase are touched: anything with a capital ("USA", "McLean") is left exactly as
 * stored, small joiners ("of", "and") stay lowercase, and hyphenated parts are each capitalized.
 * The stored value is never changed — call this only where a value is shown.
 */
export function displayCase(value: string | null | undefined): string {
  if (!value) return "";
  let seenWord = false;
  return value
    .split(/(\s+|-)/)
    .map((part) => {
      if (!part.trim() || part === "-") return part;
      const isFirstWord = !seenWord;
      seenWord = true;
      if (part !== part.toLowerCase()) return part;
      if (!isFirstWord && JOINERS.has(part)) return part;
      return part.charAt(0).toUpperCase() + part.slice(1);
    })
    .join("");
}
