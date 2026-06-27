import { parseStoredPhone } from "@/lib/phone-utils";
import { COUNTRY_CODES } from "@/lib/country-codes";

// Derive a nationality label from the lead's phone country code.
// Ambiguous dial codes (+1 → Canada/USA, +7 → Russia/Kazakhstan) resolve to the
// first match in COUNTRY_CODES — acceptable for a read-time fallback.
export function nationalityFromPhone(phone: string | null | undefined): string | null {
  if (!phone) return null;
  const { dialCode } = parseStoredPhone(phone);
  const match = COUNTRY_CODES.find((c) => c.dialCode === dialCode);
  return match?.label ?? null;
}
