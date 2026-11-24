import { randomUUID } from "crypto";

// emails.rfc_message_id is NOT NULL (migration 025 — never relaxed; migration 191 only relaxed
// gmail_message_id and connected_email_account_id), but a Resend send hands back Resend's own id, not
// the RFC 5322 Message-ID the mail server stamps on the wire. So a company-sender row stores a unique
// SYNTHETIC id instead of null.
//
// It is deliberately never a real address: the reserved ".invalid" TLD can't resolve, so it can never
// collide with a lead's real header. Nothing relies on it matching — replies are routed by the per-message
// reply token (inbound_addresses), not by In-Reply-To — and it is stripped from outgoing In-Reply-To /
// References headers so no mail client ever sees it.

export const SYNTHETIC_MESSAGE_ID_SUFFIX = "@resend.edgex.invalid>";

/** `<resend-id@resend.edgex.invalid>` — unique per provider message id (random when there is none). */
export function syntheticMessageId(providerMessageId: string | null | undefined): string {
  return `<${providerMessageId || randomUUID()}${SYNTHETIC_MESSAGE_ID_SUFFIX}`;
}

export function isSyntheticMessageId(id: string | null | undefined): boolean {
  return typeof id === "string" && id.endsWith(SYNTHETIC_MESSAGE_ID_SUFFIX);
}
