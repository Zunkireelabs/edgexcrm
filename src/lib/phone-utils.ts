import { isValidPhoneNumber } from "libphonenumber-js";
import { COUNTRY_CODES, DEFAULT_DIAL_CODE } from "./country-codes";

/**
 * Parse a stored phone string into dial code + local number.
 * Handles formats: "+977-9863826770", "+977 9863826770", "+9779863826770", "9863826770"
 */
export function parseStoredPhone(phone: string): {
  dialCode: string;
  localNumber: string;
} {
  if (!phone) return { dialCode: DEFAULT_DIAL_CODE, localNumber: "" };

  const trimmed = phone.trim();

  // If it starts with +, try to extract dial code
  if (trimmed.startsWith("+")) {
    // Try matching with separator (dash or space)
    const withSep = trimmed.match(/^(\+\d{1,4})[-\s](.+)$/);
    if (withSep) {
      return { dialCode: withSep[1], localNumber: withSep[2] };
    }

    // No separator — try to match known dial codes (longest first)
    const sorted = [...COUNTRY_CODES]
      .filter((c) => c.dialCode)
      .sort((a, b) => b.dialCode.length - a.dialCode.length);

    for (const cc of sorted) {
      if (trimmed.startsWith(cc.dialCode)) {
        return {
          dialCode: cc.dialCode,
          localNumber: trimmed.slice(cc.dialCode.length),
        };
      }
    }

    // Unknown dial code — take first 2-4 digits as code
    const fallback = trimmed.match(/^(\+\d{1,4})(.*)$/);
    if (fallback) {
      return { dialCode: fallback[1], localNumber: fallback[2] };
    }
  }

  // No + prefix — treat as local number with default code
  return { dialCode: DEFAULT_DIAL_CODE, localNumber: trimmed };
}

/**
 * Format dial code + local number for database storage.
 * Strips duplicate dial code if user pasted full number.
 */
export function formatPhoneForStorage(
  dialCode: string,
  localNumber: string
): string {
  if (!localNumber) return "";
  let clean = localNumber.trim();

  // Strip leading dial code if user pasted it
  if (clean.startsWith(dialCode)) {
    clean = clean.slice(dialCode.length);
  }
  // Strip leading + variant
  if (clean.startsWith("+")) {
    const parsed = parseStoredPhone(clean);
    clean = parsed.localNumber;
  }
  // Remove any separators for clean storage
  clean = clean.replace(/^[-\s]+/, "");

  return `${dialCode}-${clean}`;
}

/**
 * Normalize any stored/incoming phone string to the "+<dialcode>-<local>" format.
 * Idempotent — already-prefixed numbers re-parse cleanly. Bare digits get the
 * default dial code (matches PhoneInput's own default behavior).
 */
export function normalizePhoneForStorage(phone: string | null | undefined): string | null {
  if (!phone) return phone ?? null;
  const { dialCode, localNumber } = parseStoredPhone(phone);
  return formatPhoneForStorage(dialCode, localNumber) || null;
}

/**
 * Format for tel: links — "+9779863826770"
 */
export function formatPhoneForTel(phone: string): string {
  if (!phone) return "";
  const { dialCode, localNumber } = parseStoredPhone(phone);
  const digits = localNumber.replace(/[^0-9]/g, "");
  return `${dialCode}${digits}`;
}

/**
 * Format for WhatsApp wa.me/ links — "9779863826770" (no +)
 */
export function formatPhoneForWhatsApp(phone: string): string {
  return formatPhoneForTel(phone).replace(/^\+/, "");
}

// Validates a stored "+<dialCode>-<local>" phone against the real
// length/format rules for that dial code (libphonenumber-js), not just a
// generic digit-count floor. Passed as a full E.164-ish string rather than
// pinned to one guessed ISO country — several of our dial codes are shared
// by multiple countries (+1: US/Canada/Jamaica/..., +7: Russia/Kazakhstan),
// and letting the library match the digits themselves avoids validating
// against the wrong country's pattern for those.
export function isValidPhoneForCountry(phone: string): boolean {
  const { dialCode, localNumber } = parseStoredPhone(phone);
  if (!localNumber) return false;
  try {
    return isValidPhoneNumber(`${dialCode}${localNumber}`);
  } catch {
    return false;
  }
}
