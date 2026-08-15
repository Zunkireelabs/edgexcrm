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

// The inverse direction: sms_messages.to_phone (bare 10-digit MSISDN, always
// Nepal — v3 rejects anything else, see toProviderRecipient above) back to the
// normalized E.164 shape sms_suppressions.phone_e164 is keyed on. Safe because
// every row in sms_messages.to_phone was produced by toProviderRecipient and
// is therefore already confirmed +977.
export function providerMsisdnToE164(msisdn: string): string {
  return `+977${msisdn}`;
}
