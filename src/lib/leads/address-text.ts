// Plain-text address helpers with NO imports — safe for client bundles (the public consent signing page uses this).

/**
 * The address WITHOUT its trailing country — for places that already show the country next to it (the Address card, a
 * consent document that also prints `{{country}}`). A Nepal address is composed with the country as its last part
 * ("…, Bagmati, Nepal"), so showing both prints the country twice.
 *
 * The address must END with the country as a whole, comma-separated part: "…, Nepal" or just "Nepal" (ignoring case and spaces).
 * It is matched as a suffix of the whole text, not a split on commas, so a country whose own name contains a comma
 * ("Korea, South") still matches. A country that is only the end of a longer word or name ("Nepalgunj", "Port Nepal"), a country
 * in the middle, or an address that does not end with it, is left alone. A repeated trailing country ("…, Nepal, Nepal") is
 * cleaned too. Never changes what is saved; display/merge time only.
 */
export function stripTrailingCountry(address: string | null | undefined, country: string | null | undefined): string {
  let rest = (address ?? "").trim();
  const wanted = (country ?? "").trim();
  if (!rest || !wanted) return rest;
  const n = wanted.length;
  const lowered = wanted.toLowerCase();
  for (;;) {
    if (rest.toLowerCase() === lowered) return "";
    if (rest.length <= n || rest.slice(-n).toLowerCase() !== lowered) return rest;
    // What comes before it must be a comma — otherwise the country is just the tail of a longer word or name.
    const head = rest.slice(0, rest.length - n).trimEnd();
    if (!head.endsWith(",")) return rest;
    rest = head.slice(0, -1).trim();
  }
}

/**
 * True when the city is already part of the address text — as a whole word, ignoring case. A Nepal address is composed from its
 * municipality ("…, Birgunj Metropolitan City, Parsa, …") and the City field is filled from that same municipality ("Birgunj"),
 * so a document that prints both shows the city twice. "Birgunj" is found inside "Birgunj Metropolitan City", but "Lalit" is NOT
 * found inside "Lalitpur" (the match must start and end at a word boundary). Display/merge time only; never changes what is saved.
 */
export function addressContainsCity(address: string | null | undefined, city: string | null | undefined): boolean {
  const text = (address ?? "").trim();
  const wanted = (city ?? "").trim();
  if (!text || !wanted) return false;
  const escaped = wanted.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(^|[^\\p{L}\\p{N}])${escaped}($|[^\\p{L}\\p{N}])`, "iu").test(text);
}
