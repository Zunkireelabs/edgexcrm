import { randomBytes, createHash, timingSafeEqual } from "crypto";

const API_KEY_PREFIX = "crm_live_";

/**
 * Generate a new API key pair.
 * Returns the raw key (shown once to user) and hashed key (stored in DB).
 * NEVER log or persist the raw key after initial generation.
 */
export function generateApiKey(): { rawKey: string; hashedKey: string } {
  const randomPart = randomBytes(32).toString("base64url");
  const rawKey = `${API_KEY_PREFIX}${randomPart}`;
  const hashedKey = hashApiKey(rawKey);
  return { rawKey, hashedKey };
}

/**
 * Hash an API key using SHA-256.
 */
export function hashApiKey(rawKey: string): string {
  return createHash("sha256").update(rawKey).digest("hex");
}

/**
 * Constant-time comparison of two hashed keys.
 * Prevents timing attacks on key verification.
 */
export function verifyApiKeyHash(
  candidateHash: string,
  storedHash: string
): boolean {
  if (candidateHash.length !== storedHash.length) {
    return false;
  }
  const a = Buffer.from(candidateHash, "utf-8");
  const b = Buffer.from(storedHash, "utf-8");
  return timingSafeEqual(a, b);
}
