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

import type { SupabaseClient } from "@supabase/supabase-js";
import type { ConnectedEmailAccount } from "@/types/database";
import { encryptToken, decryptToken } from "@/lib/inbox/crypto";
import { logger } from "@/lib/logger";

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

/**
 * Best-effort persist of a freshly-refreshed access token. Never throws —
 * an encrypt failure here must not abort the caller (a send that already
 * delivered via Gmail, or a poll cycle for other accounts); it's logged
 * and the caller proceeds using the in-memory refreshed token regardless.
 */
export async function persistRefreshedToken(
  supabase: SupabaseClient,
  accountId: string,
  refreshed: { access_token: string; expiry_date: number },
): Promise<void> {
  try {
    const { error } = await supabase
      .from("connected_email_accounts")
      .update({
        access_token: encryptAccountToken(refreshed.access_token),
        token_expiry: new Date(refreshed.expiry_date).toISOString(),
      })
      .eq("id", accountId);
    if (error) {
      logger.warn({ error, accountId }, "Failed to persist refreshed token (non-fatal)");
    }
  } catch (err) {
    logger.warn({ err, accountId }, "Failed to encrypt/persist refreshed token (non-fatal)");
  }
}
