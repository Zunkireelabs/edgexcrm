import { parseStoredPhone } from "@/lib/phone-utils";

// Aakash v3 /sms/v3/send requires bare 10-digit Nepal MSISDNs in the "to" field
// (comma-separated) — NOT "+977…". Do not reuse formatPhoneForTel() here; it
// returns the +-prefixed E.164-ish shape v3 rejects.

export type ToProviderRecipientResult =
  | { ok: true; msisdn: string }
  | { ok: false; reason: "missing" | "foreign" | "malformed" };

export function toProviderRecipient(stored: string | null | undefined): ToProviderRecipientResult {
  if (!stored || !stored.trim()) return { ok: false, reason: "missing" };

  const { dialCode, localNumber } = parseStoredPhone(stored);

  if (dialCode !== "+977") return { ok: false, reason: "foreign" };

  const digits = localNumber.replace(/[^0-9]/g, "");
  if (!/^(97|98)\d{8}$/.test(digits)) return { ok: false, reason: "malformed" };

  return { ok: true, msisdn: digits };
}
