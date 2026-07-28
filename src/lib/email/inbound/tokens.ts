// Inbound reply-token codec — pure, no I/O. Brief §2 decision 3: stored random
// tokens (144-bit, crypto.randomBytes) + a checksum suffix, NOT HMAC-derived
// addresses. Rotating INBOUND_TOKEN_SECRET only turns off the *fast* pre-DB
// reject (parseInboundAddress starts returning null for previously-valid
// checksums) — it never invalidates an already-minted token's DB row, which is
// the actual authorization boundary (resolve.ts looks it up by exact value).
// Revoking one address is `inbound_addresses.status = 'revoked'`, never a
// secret rotation.

import { randomBytes, createHmac, timingSafeEqual } from "crypto";

export type InboundVerb = "reply" | "bcc" | "fwd";

const CHECKSUM_LENGTH = 6;
const TOKEN_BYTES = 18; // 144 bits -> 36 lowercase hex chars

function getTokenSecret(): string {
  const secret = process.env.INBOUND_TOKEN_SECRET;
  if (!secret) {
    throw new Error("INBOUND_TOKEN_SECRET is not set — inbound token codec is fail-closed");
  }
  return secret;
}

/**
 * Parses INBOUND_EMAIL_DOMAINS (comma-separated) into a normalized list.
 * The first entry is the *active* domain — mintToken() builds new reply
 * addresses on it only. All entries are accepted for inbound matching
 * (parseInboundAddress) — see brief §8/§13: the reply address is baked into
 * every email already sent, so retired domains must keep resolving as long
 * as they stay in the list. A single-entry list is the degenerate case and
 * must behave identically to the old singular-var behavior.
 */
export function getInboundDomains(): string[] {
  const raw = process.env.INBOUND_EMAIL_DOMAINS;
  if (!raw) {
    throw new Error("INBOUND_EMAIL_DOMAINS is not set — inbound token codec is fail-closed");
  }
  const domains = raw
    .split(",")
    .map((d) => d.trim().toLowerCase())
    .filter((d) => d.length > 0);
  if (domains.length === 0) {
    throw new Error("INBOUND_EMAIL_DOMAINS is empty — inbound token codec is fail-closed");
  }
  return domains;
}

const ENV_MARKERS = ["l", "s", "p"] as const;
type EnvMarker = (typeof ENV_MARKERS)[number];

/**
 * Single-char environment marker (l/s/p — local/stage/prod), embedded in every
 * minted address as <verb>+<env><token><checksum>. Stage and prod share one
 * Resend account and inbound domain (free plan = 1 domain), so both webhook
 * endpoints receive every email.received event; without this marker, an
 * environment would dead-letter every *other* environment's mail, leaking
 * real customer PII (From/subject/raw_event) into the un-anonymized stage DB.
 * Fail-closed, same pattern as the other required inbound envs.
 */
function getEnvMarker(): EnvMarker {
  const marker = process.env.INBOUND_ENV_MARKER;
  if (!marker || !(ENV_MARKERS as readonly string[]).includes(marker)) {
    throw new Error("INBOUND_ENV_MARKER is not set to one of l/s/p — inbound token codec is fail-closed");
  }
  return marker as EnvMarker;
}

function computeChecksum(token: string, secret: string): string {
  return createHmac("sha256", secret).update(token).digest("hex").slice(0, CHECKSUM_LENGTH);
}

export interface MintedInboundAddress {
  /** Stored verbatim in inbound_addresses.token — the DB-unique, revocable authorization key. */
  token: string;
  /** 6-char cheap pre-DB reject suffix, appended to the token in the address local-part. */
  checksum: string;
  /** e.g. "reply+ab12...cd34ef" */
  localPart: string;
  /** e.g. "reply+ab12...cd34ef@inbound.edgex.zunkireelabs.com" */
  address: string;
}

export function mintToken(verb: InboundVerb = "reply"): MintedInboundAddress {
  const secret = getTokenSecret();
  // First entry is the active domain — new addresses always mint on it.
  const domain = getInboundDomains()[0];
  const marker = getEnvMarker();
  // Lowercase hex — deliberately not base64url: email local-parts get
  // lowercased for matching (§8), and a mixed-case alphabet would make that
  // lossy for the token itself.
  const token = randomBytes(TOKEN_BYTES).toString("hex");
  const checksum = computeChecksum(token, secret);
  const localPart = `${verb}+${marker}${token}${checksum}`;
  return { token, checksum, localPart, address: `${localPart}@${domain}` };
}

/** Verifies a candidate (token, checksum) pair against the current INBOUND_TOKEN_SECRET. */
export function verifyChecksum(token: string, checksum: string): boolean {
  let secret: string;
  try {
    secret = getTokenSecret();
  } catch {
    return false;
  }
  const expected = computeChecksum(token, secret);
  if (expected.length !== checksum.length) return false;
  return timingSafeEqual(Buffer.from(expected, "utf8"), Buffer.from(checksum, "utf8"));
}

export interface ParsedInboundAddress {
  verb: InboundVerb;
  token: string;
}

/**
 * Parses a single recipient address (may be "Display Name <addr>" or a bare
 * address) into a verb + checksum-verified token, or null on any mismatch.
 * Never throws — a hostile/malformed input is just a non-match. Tenant
 * resolution reads ONLY this output (brief §8) — never `From:`, never a
 * header, never the body.
 *
 * A well-formed address minted for a SIBLING environment (right domain,
 * right verb, structurally valid — just a different env marker) also
 * returns null here, same bucket as any other non-candidate. That is
 * deliberate: resolve.ts's `hadCandidateButNoMatch` only flips true when
 * parseInboundAddress succeeds but the DB lookup doesn't, so a cross-env
 * delivery is silently ignored — no dead-letter row, no PII leak (brief §8).
 */
export function parseInboundAddress(raw: string): ParsedInboundAddress | null {
  if (!raw) return null;

  let domains: string[];
  let ourMarker: EnvMarker;
  try {
    domains = getInboundDomains();
    ourMarker = getEnvMarker();
  } catch {
    return null;
  }

  const angleMatch = raw.match(/<([^>]+)>/);
  const emailPart = (angleMatch ? angleMatch[1] : raw).trim().toLowerCase();

  const atIndex = emailPart.lastIndexOf("@");
  if (atIndex === -1) return null;

  const localPart = emailPart.slice(0, atIndex);
  const domainPart = emailPart.slice(atIndex + 1);

  // Exact match against ANY entry in the list. "inbound.edgex.zunkireelabs.com.evil.com"
  // must NOT match "inbound.edgex.zunkireelabs.com" — endsWith would let it through.
  if (!domains.includes(domainPart)) return null;

  const plusIndex = localPart.indexOf("+");
  if (plusIndex === -1) return null;

  const verb = localPart.slice(0, plusIndex);
  if (verb !== "reply" && verb !== "bcc" && verb !== "fwd") return null;

  const markerAndRest = localPart.slice(plusIndex + 1);
  if (markerAndRest.length === 0 || markerAndRest[0] !== ourMarker) return null;

  const tokenWithChecksum = markerAndRest.slice(1);
  if (tokenWithChecksum.length <= CHECKSUM_LENGTH) return null;

  const token = tokenWithChecksum.slice(0, -CHECKSUM_LENGTH);
  const checksum = tokenWithChecksum.slice(-CHECKSUM_LENGTH);

  if (!verifyChecksum(token, checksum)) return null;

  return { verb, token };
}
