// Gmail inbox-connect OAuth state — CSRF binding for the connect → Google →
// callback round trip. Extracted from the two routes that used to duplicate
// this (and, before docs/PROD-HARDENING-BRIEF.md §1.1, both fell back to
// NEXT_PUBLIC_SUPABASE_ANON_KEY when NEXTAUTH_SECRET was unset — a PUBLIC
// value, so the HMAC was signed with something any client already has).
// Fail-closed: no fallback exists here, on purpose.
//
// TODO(PROD-HARDEN §1.2): state is a static HMAC(userId) with no nonce or
// expiry, so a captured state value is replayable forever even with a
// correctly-configured secret. Fixing that needs a nonce + short TTL (and
// somewhere to store it). Out of scope for this PR — flagged, not fixed.

import { createHmac, timingSafeEqual } from "crypto";

const SIG_LENGTH = 16;

function getOAuthStateSecret(): string {
  const secret = process.env.NEXTAUTH_SECRET;
  if (!secret) {
    throw new Error("NEXTAUTH_SECRET is not set — Gmail OAuth state signing is fail-closed");
  }
  return secret;
}

/** Whether the required secret is present. Routes check this before calling signState(). */
export function isOAuthStateSecretConfigured(): boolean {
  return Boolean(process.env.NEXTAUTH_SECRET);
}

function computeSig(userId: string, secret: string): string {
  return createHmac("sha256", secret).update(userId).digest("hex").slice(0, SIG_LENGTH);
}

/** Throws if NEXTAUTH_SECRET is unset — callers must check isOAuthStateSecretConfigured() first. */
export function signState(userId: string): string {
  const secret = getOAuthStateSecret();
  return `${userId}.${computeSig(userId, secret)}`;
}

/** Never throws — an unset secret or any malformed/mismatched state just verifies false. */
export function verifyState(state: string, userId: string): boolean {
  const parts = state.split(".");
  if (parts.length !== 2) return false;
  const [embeddedUserId, sig] = parts;
  if (embeddedUserId !== userId) return false;

  let secret: string;
  try {
    secret = getOAuthStateSecret();
  } catch {
    return false;
  }

  const expected = computeSig(userId, secret);
  if (expected.length !== sig.length) return false;
  return timingSafeEqual(Buffer.from(expected, "utf8"), Buffer.from(sig, "utf8"));
}
