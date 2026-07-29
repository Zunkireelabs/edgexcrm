import { describe, it, expect, vi, beforeEach } from "vitest";
import { mintToken } from "./tokens";

const DOMAIN = "inbound.edgex.zunkireelabs.com";

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let dbRows: any[] = [];
const rateLimitMock = vi.fn(async (key: string, config: unknown) => {
  void key;
  void config;
  return { allowed: true, remaining: 1, limit: 1, resetAt: 0, retryAfterSeconds: 0 };
});

vi.mock("@/lib/api/rate-limit", () => ({
  checkRateLimit: (key: string, config: unknown) => rateLimitMock(key, config),
  INBOUND_TOKEN_LIMIT: { maxRequests: 30, windowMs: 60_000 },
}));

vi.mock("@/lib/supabase/server", () => ({
  createServiceClient: vi.fn(async () => ({
    from: vi.fn(() => {
      const filters: Record<string, unknown> = {};
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const c: any = {};
      c.select = vi.fn(() => c);
      c.eq = vi.fn((col: string, val: unknown) => {
        filters[col] = val;
        return c;
      });
      c.maybeSingle = vi.fn(async () => {
        const match = dbRows.find((r) => Object.entries(filters).every(([k, v]) => r[k] === v));
        return { data: match ?? null, error: null };
      });
      return c;
    }),
  })),
}));

import { resolveInboundRecipients } from "./resolve";

beforeEach(() => {
  process.env.INBOUND_TOKEN_SECRET = "a".repeat(64);
  process.env.INBOUND_EMAIL_DOMAINS = DOMAIN;
  process.env.INBOUND_ENV_MARKER = "l";
  dbRows = [];
  rateLimitMock.mockReset();
  rateLimitMock.mockResolvedValue({ allowed: true, remaining: 1, limit: 1, resetAt: 0, retryAfterSeconds: 0 });
});

describe("resolveInboundRecipients", () => {
  it("zero-match: no candidate parses to a valid token", async () => {
    const result = await resolveInboundRecipients({
      to: ["someone@gmail.com"],
      cc: [],
      bcc: [],
    });
    expect(result).toEqual({ matches: [], hadCandidateButNoMatch: false });
  });

  it("resolves a single active match from `to`", async () => {
    const minted = mintToken("reply");
    dbRows = [
      { id: "addr-1", tenant_id: "tenant-a", kind: "thread", verb: "reply", token: minted.token, thread_id: "thread-1", user_id: null, status: "active" },
    ];

    const result = await resolveInboundRecipients({ to: [minted.address], cc: [], bcc: [] });

    expect(result.hadCandidateButNoMatch).toBe(false);
    expect(result.matches).toEqual([
      { id: "addr-1", tenantId: "tenant-a", kind: "thread", verb: "reply", token: minted.token, threadId: "thread-1", userId: null },
    ]);
  });

  it("multi-tenant CC: two distinct tokens for two distinct tenants both resolve independently", async () => {
    const mintedA = mintToken("reply");
    const mintedB = mintToken("reply");
    dbRows = [
      { id: "addr-a", tenant_id: "tenant-a", kind: "thread", verb: "reply", token: mintedA.token, thread_id: "thread-a", user_id: null, status: "active" },
      { id: "addr-b", tenant_id: "tenant-b", kind: "thread", verb: "reply", token: mintedB.token, thread_id: "thread-b", user_id: null, status: "active" },
    ];

    const result = await resolveInboundRecipients({
      to: [mintedA.address],
      cc: [mintedB.address],
      bcc: [],
    });

    expect(result.matches).toHaveLength(2);
    const tenantIds = result.matches.map((m) => m.tenantId).sort();
    expect(tenantIds).toEqual(["tenant-a", "tenant-b"]);
  });

  it("revoked token: a well-formed, checksum-valid token whose row is revoked does not resolve", async () => {
    const minted = mintToken("reply");
    // Row exists but status='revoked' — the query's .eq("status","active") filter excludes it.
    dbRows = [
      { id: "addr-1", tenant_id: "tenant-a", kind: "thread", verb: "reply", token: minted.token, thread_id: "thread-1", user_id: null, status: "revoked" },
    ];

    const result = await resolveInboundRecipients({ to: [minted.address], cc: [], bcc: [] });

    expect(result.matches).toEqual([]);
    expect(result.hadCandidateButNoMatch).toBe(true);
  });

  it("exact-domain enforcement: a lookalike domain never reaches the DB as a match", async () => {
    const minted = mintToken("reply");
    dbRows = [
      { id: "addr-1", tenant_id: "tenant-a", kind: "thread", verb: "reply", token: minted.token, thread_id: "thread-1", user_id: null, status: "active" },
    ];
    const lookalike = `${minted.localPart}@${DOMAIN}.evil.com`;

    const result = await resolveInboundRecipients({ to: [lookalike], cc: [], bcc: [] });

    expect(result).toEqual({ matches: [], hadCandidateButNoMatch: false });
  });

  it("rate-limited token: counted as hadCandidateButNoMatch, never resolved", async () => {
    const minted = mintToken("reply");
    dbRows = [
      { id: "addr-1", tenant_id: "tenant-a", kind: "thread", verb: "reply", token: minted.token, thread_id: "thread-1", user_id: null, status: "active" },
    ];
    rateLimitMock.mockResolvedValue({ allowed: false, remaining: 0, limit: 30, resetAt: 0, retryAfterSeconds: 30 });

    const result = await resolveInboundRecipients({ to: [minted.address], cc: [], bcc: [] });

    expect(result.matches).toEqual([]);
    expect(result.hadCandidateButNoMatch).toBe(true);
  });

  it("dedupes the same token appearing in both to and cc into a single resolution", async () => {
    const minted = mintToken("reply");
    dbRows = [
      { id: "addr-1", tenant_id: "tenant-a", kind: "thread", verb: "reply", token: minted.token, thread_id: "thread-1", user_id: null, status: "active" },
    ];

    const result = await resolveInboundRecipients({ to: [minted.address], cc: [minted.address], bcc: [] });

    expect(result.matches).toHaveLength(1);
    expect(rateLimitMock).toHaveBeenCalledTimes(1);
  });

  it("unknown token: well-formed + checksum-valid but no DB row at all", async () => {
    const minted = mintToken("reply");
    dbRows = []; // nothing seeded

    const result = await resolveInboundRecipients({ to: [minted.address], cc: [], bcc: [] });

    expect(result.matches).toEqual([]);
    expect(result.hadCandidateButNoMatch).toBe(true);
  });

  it("cross-environment delivery (right domain, sibling env marker): silently ignored, never hadCandidateButNoMatch", async () => {
    process.env.INBOUND_ENV_MARKER = "s"; // mint as stage
    const mintedOnStage = mintToken("reply");
    dbRows = [
      { id: "addr-1", tenant_id: "tenant-a", kind: "thread", verb: "reply", token: mintedOnStage.token, thread_id: "thread-1", user_id: null, status: "active" },
    ];

    process.env.INBOUND_ENV_MARKER = "p"; // now resolve as prod — this env's webhook received stage's mail
    const result = await resolveInboundRecipients({ to: [mintedOnStage.address], cc: [], bcc: [] });

    // Not just zero matches — hadCandidateButNoMatch must stay false so the
    // caller never writes a dead-letter row (brief §8: PII leak prevention).
    expect(result).toEqual({ matches: [], hadCandidateButNoMatch: false });
  });

  it("resolves a candidate addressed to a non-first entry of a multi-domain INBOUND_EMAIL_DOMAINS list", async () => {
    const OTHER_DOMAIN = "lead-crm.zunkireelabs.com";
    process.env.INBOUND_EMAIL_DOMAINS = `${OTHER_DOMAIN},${DOMAIN}`;

    const minted = mintToken("reply"); // mints on OTHER_DOMAIN (first/active entry)
    expect(minted.address.endsWith(`@${OTHER_DOMAIN}`)).toBe(true);

    // A historical reply address on the retired-but-still-listed DOMAIN must still resolve.
    const historicalAddress = `${minted.localPart}@${DOMAIN}`;
    dbRows = [
      { id: "addr-1", tenant_id: "tenant-a", kind: "thread", verb: "reply", token: minted.token, thread_id: "thread-1", user_id: null, status: "active" },
    ];

    const result = await resolveInboundRecipients({ to: [historicalAddress], cc: [], bcc: [] });

    expect(result.matches).toEqual([
      { id: "addr-1", tenantId: "tenant-a", kind: "thread", verb: "reply", token: minted.token, threadId: "thread-1", userId: null },
    ]);
  });
});
