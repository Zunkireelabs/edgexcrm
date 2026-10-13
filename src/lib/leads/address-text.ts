// Plain-text address helpers with NO imports — safe for client bundles (the public consent signing page uses this).

/**
 * The address WITHOUT its trailing country — for places that already show the country next to it (the Address card, a
 * consent document that also prints `{{country}}`). A Nepal address is composed with the country as its last part
 * ("…, Bagmati, Nepal"), so showing both prints the country twice.
 *
 * Only a trailing comma-separated part that equals `country` (ignoring case and spaces) is dropped — repeatedly, so
 * "…, Nepal, Nepal" is cleaned too. A country in the middle, or an address that does not end with it, is left alone.
 * Never changes what is saved; display/merge time only.
 */
export function stripTrailingCountry(address: string | null | undefined, country: string | null | undefined): string {
  let rest = (address ?? "").trim();
  const target = (country ?? "").trim().toLowerCase();
  if (!rest || !target) return rest;
  for (;;) {
    const cut = rest.lastIndexOf(",");
    const last = (cut === -1 ? rest : rest.slice(cut + 1)).trim().toLowerCase();
    if (last !== target) return rest;
    if (cut === -1) return "";
    rest = rest.slice(0, cut).trim();
  }
}
