// AES-256-GCM token helpers for inbox channel access tokens at rest.
// Key: INBOX_TOKEN_ENC_KEY env var — 32-byte value as hex (64 chars) or base64 (44 chars).
// Ciphertext format: base64(iv[12] ‖ authTag[16] ‖ ciphertext)
// Fail-closed: throw if the key is missing or malformed.

import { createCipheriv, createDecipheriv, randomBytes } from "crypto";

const ALGORITHM = "aes-256-gcm";
const IV_BYTES = 12;
const TAG_BYTES = 16;

function loadKey(): Buffer {
  const raw = process.env.INBOX_TOKEN_ENC_KEY;
  if (!raw) throw new Error("INBOX_TOKEN_ENC_KEY is not set — cannot encrypt/decrypt channel tokens");

  const trimmed = raw.trim();
  if (/^[0-9a-fA-F]{64}$/.test(trimmed)) {
    return Buffer.from(trimmed, "hex");
  }
  // Accept base64 (standard or url-safe)
  const decoded = Buffer.from(trimmed, "base64");
  if (decoded.length !== 32) {
    throw new Error("INBOX_TOKEN_ENC_KEY must be a 32-byte value (hex 64 chars or base64 44 chars)");
  }
  return decoded;
}

export function encryptToken(plaintext: string): string {
  const key = loadKey();
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGORITHM, key, iv);

  const ct = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();

  const blob = Buffer.concat([iv, tag, ct]);
  return blob.toString("base64");
}

export function decryptToken(blob: string): string {
  const key = loadKey();
  const buf = Buffer.from(blob, "base64");

  if (buf.length < IV_BYTES + TAG_BYTES + 1) {
    throw new Error("Encrypted token blob is too short");
  }

  const iv = buf.subarray(0, IV_BYTES);
  const tag = buf.subarray(IV_BYTES, IV_BYTES + TAG_BYTES);
  const ct = buf.subarray(IV_BYTES + TAG_BYTES);

  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(tag);

  return Buffer.concat([decipher.update(ct), decipher.final()]).toString("utf8");
}
