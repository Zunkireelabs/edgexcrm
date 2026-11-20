const DEVANAGARI_ZERO = 0x0966; // ०

/** C2: Devanagari digits ०–९ become 0–9, so "५ दिन" counts as 5 in every number check (`\d` does not match them). */
export function normalizeDigits(s: string): string {
  return s.replace(/[०-९]/g, (d) => String(d.charCodeAt(0) - DEVANAGARI_ZERO));
}

/** Every number in `s` (decimals with . or , as one number, Devanagari included), as strings like "3.5". Leading zeros are dropped ("05" is 5), so "5 December" matches a fact that holds "2026-12-05" (F7). */
export function numbersIn(s: string): string[] {
  return (normalizeDigits(s).match(/\d+(?:[.,]\d+)?/g) ?? []).map((n) => n.replace(",", ".").replace(/^0+(?=\d)/, ""));
}
