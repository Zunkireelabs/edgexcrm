// Encryption for connected Gmail account tokens at rest.
//
// Wraps the shared AES-256-GCM helpers (@/lib/inbox/crypto, keyed by
// INBOX_TOKEN_ENC_KEY) with a version prefix so we can distinguish an
// encrypted value from a legacy plaintext one that predates this change.
//
//   encrypted value:  "enc:v1:<base64 blob>"
//   legacy value:     the raw token string (no prefix)
//
// Write path always encrypts. Read path decrypts prefixed values and passes
// legacy plaintext through untouched — so existing rows keep working and get
// re-encrypted on their next token write (refresh or reconnect). No data
// migration required.

import type { ConnectedEmailAccount } from "@/types/database";
import { encryptToken, decryptToken } from "@/lib/inbox/crypto";

const PREFIX = "enc:v1:";

/** Encrypt a token for storage. Throws if INBOX_TOKEN_ENC_KEY is unset (fail-closed). */
export function encryptAccountToken(plaintext: string): string {
  return PREFIX + encryptToken(plaintext);
}

/** Decrypt a stored token. Legacy (unprefixed) plaintext is returned as-is. */
export function decryptAccountToken(stored: string): string {
  if (stored.startsWith(PREFIX)) {
    return decryptToken(stored.slice(PREFIX.length));
  }
  return stored;
}

/**
 * Return a copy of a connected-email-account row with its token columns
 * decrypted, ready to hand to the Gmail client. Call this once, right after
 * loading the row from the DB; every downstream consumer then sees plaintext.
 */
export function decryptAccountTokens<T extends Pick<ConnectedEmailAccount, "refresh_token" | "access_token">>(
  account: T,
): T {
  return {
    ...account,
    refresh_token: decryptAccountToken(account.refresh_token),
    access_token: account.access_token ? decryptAccountToken(account.access_token) : account.access_token,
  };
}
