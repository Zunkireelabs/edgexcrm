import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createHmac, randomBytes } from "crypto";

vi.mock("@/lib/logger", () => ({ logger: { error: vi.fn(), warn: vi.fn(), info: vi.fn() } }));
const { checkRateLimit } = vi.hoisted(() => ({ checkRateLimit: vi.fn() }));
vi.mock("@/lib/api/rate-limit", async (importOriginal) => ({ ...(await importOriginal<typeof import("@/lib/api/rate-limit")>()), checkRateLimit }));

import { createChatSession } from "./session";
import { encryptToken } from "../crypto";
import { DEFAULT_WEBSITE_CHAT_SETTINGS } from "./settings";

const INBOX = "AbCdEfGhIjKlMnOpQrStUvWx"; // 24 chars, like Chatwoot's identifiers
const SECRET = "hmac-secret-from-chatwoot";
const ok = { allowed: true, remaining: 10, limit: 60, resetAt: 0, retryAfterSeconds: 0 };

function channel(overrides: Record<string, unknown> = {}) {
  return {
    meta: {
      website_chat: {
        enabled: true,
        inboxType: "api",
        inboxIdentifier: INBOX,
        hmacTokenEnc: encryptToken(SECRET),
        settings: { ...DEFAULT_WEBSITE_CHAT_SETTINGS, websiteHost: "admizzeducation.com" },
        ...overrides,
      },
    },
  };
}

function fakeDb(row: unknown, error: { message: string } | null = null) {
  const eqs: Array<[string, unknown]> = [];
  const chain = {
    select: () => chain,
    eq: (col: string, val: unknown) => {
      eqs.push([col, val]);
      return chain;
    },
    maybeSingle: async () => ({ data: row, error }),
  };
  const from = vi.fn(() => chain);
  return { db: { from } as never, eqs, from };
}

const call = (db: never, origin: string | null = "https://admizzeducation.com", inboxIdentifier: unknown = INBOX, ip = "1.2.3.4") =>
  createChatSession({ db, inboxIdentifier, origin, ip });

beforeEach(() => {
  checkRateLimit.mockReset().mockResolvedValue(ok);
  process.env.INBOX_TOKEN_ENC_KEY = randomBytes(32).toString("hex");
  process.env.INBOX_CHATWOOT_ENABLED = "true";
  process.env.CHATWOOT_BASE_URL = "https://inbox.example.com";
  delete process.env.INBOX_CHATWOOT_DEV_ALLOWED_ORIGINS;
});
afterEach(() => vi.unstubAllEnvs());

describe("createChatSession: the happy path", () => {
  it("returns a fresh visitor id and its HMAC signature, and echoes the allowed origin", async () => {
    const { db, eqs } = fakeDb(channel());
    const result = await call(db);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.origin).toBe("https://admizzeducation.com");
    expect(result.session).toMatchObject({ chatwootBaseUrl: "https://inbox.example.com", inboxIdentifier: INBOX });
    expect(result.session.identifier).toMatch(/^[0-9a-f-]{36}$/);
    // The signature is exactly what Chatwoot recomputes: HMAC-SHA256 of the identifier with the inbox secret.
    expect(result.session.identifierHash).toBe(createHmac("sha256", SECRET).update(result.session.identifier).digest("hex"));
    // It looks the inbox up by provider, active status and its public identifier only.
    expect(eqs).toEqual([["provider", "chatwoot"], ["status", "active"], ["meta->website_chat->>inboxIdentifier", INBOX]]);
  });

  it("never leaks the secret or the stored ciphertext", async () => {
    const row = channel();
    const result = await call(fakeDb(row).db);
    const json = JSON.stringify(result);
    expect(json).not.toContain(SECRET);
    expect(json).not.toContain(row.meta.website_chat.hmacTokenEnc);
  });

  it("gives every visitor a different id", async () => {
    const { db } = fakeDb(channel());
    const a = await call(db);
    const b = await call(db);
    if (!a.ok || !b.ok) throw new Error("expected ok");
    expect(a.session.identifier).not.toBe(b.session.identifier);
    expect(a.session.identifierHash).not.toBe(b.session.identifierHash);
  });

  it("counts the visitor's address and the whole inbox against their own limits", async () => {
    await call(fakeDb(channel()).db);
    expect(checkRateLimit.mock.calls.map((c) => c[0])).toEqual([`chat_session_ip:1.2.3.4`, `chat_session_inbox:${INBOX}`]);
  });
});

describe("createChatSession: which websites may ask", () => {
  it.each(["https://admizzeducation.com", "https://www.admizzeducation.com", "HTTPS://Admizzeducation.COM"])("allows %s", async (origin) => {
    expect((await call(fakeDb(channel()).db, origin)).ok).toBe(true);
  });

  it.each(["https://evil.example", "http://admizzeducation.com", "https://admizzeducation.com.evil.example", "https://dev-web.admizzeducation.com"])(
    "refuses %s",
    async (origin) => {
      expect(await call(fakeDb(channel()).db, origin)).toMatchObject({ ok: false, status: 403 });
    }
  );

  it("refuses a request with no Origin at all (curl and most scripts)", async () => {
    expect(await call(fakeDb(channel()).db, null)).toMatchObject({ ok: false, status: 403 });
    expect(await call(fakeDb(channel()).db, "")).toMatchObject({ ok: false, status: 403 });
  });

  it("allows a development origin outside production, never in production", async () => {
    process.env.INBOX_CHATWOOT_DEV_ALLOWED_ORIGINS = "http://admizz.localhost:3001";
    expect((await call(fakeDb(channel()).db, "http://admizz.localhost:3001")).ok).toBe(true);
    vi.stubEnv("NODE_ENV", "production");
    expect(await call(fakeDb(channel()).db, "http://admizz.localhost:3001")).toMatchObject({ ok: false, status: 403 });
  });
});

describe("createChatSession: things that must all look like 'not found'", () => {
  const notFound = { ok: false, status: 404, code: "NOT_FOUND" };

  it.each([
    ["no such inbox", () => null],
    ["chat switched off", () => channel({ enabled: false })],
    ["Chatwoot's own window (web_widget)", () => channel({ inboxType: "web_widget" })],
    ["an old row without the type", () => channel({ inboxType: undefined })],
    ["no stored secret", () => channel({ hmacTokenEnc: undefined })],
    ["no website saved", () => channel({ settings: {} })],
  ])("%s", async (_name, row) => {
    // Built inside the test: the encryption key only exists once beforeEach has run.
    expect(await call(fakeDb(row()).db)).toMatchObject(notFound);
  });

  it("does nothing at all when website chat is not enabled on this server", async () => {
    process.env.INBOX_CHATWOOT_ENABLED = "false";
    const { db, from } = fakeDb(channel());
    expect(await call(db)).toMatchObject(notFound);
    expect(from).not.toHaveBeenCalled();
    expect(checkRateLimit).not.toHaveBeenCalled();
  });
});

describe("createChatSession: bad input", () => {
  it.each([undefined, null, 5, "", "short", "has spaces in it ok?", "x".repeat(65), "../../etc/passwd-aaaaaaaa"])("rejects the inbox id %j without touching the database", async (bad) => {
    const { db, from } = fakeDb(channel());
    // Direct call: the helper above would turn undefined into its default, valid id.
    expect(await createChatSession({ db, inboxIdentifier: bad, origin: "https://admizzeducation.com", ip: "1.2.3.4" })).toMatchObject({ ok: false, status: 400 });
    expect(from).not.toHaveBeenCalled();
    expect(checkRateLimit).not.toHaveBeenCalled();
  });
});

describe("createChatSession: limits and failures", () => {
  it("stops a flooding address before it reaches the database", async () => {
    checkRateLimit.mockResolvedValueOnce({ ...ok, allowed: false, retryAfterSeconds: 42 });
    const { db, from } = fakeDb(channel());
    expect(await call(db)).toMatchObject({ ok: false, status: 429, retryAfterSeconds: 42 });
    expect(from).not.toHaveBeenCalled();
  });

  it("stops a whole inbox that is being flooded from many addresses, and signs nothing", async () => {
    checkRateLimit.mockResolvedValueOnce(ok).mockResolvedValueOnce({ ...ok, allowed: false, retryAfterSeconds: 9 });
    expect(await call(fakeDb(channel()).db)).toMatchObject({ ok: false, status: 429, retryAfterSeconds: 9 });
  });

  it("says unavailable (not 'not found') when the lookup itself fails", async () => {
    expect(await call(fakeDb(null, { message: "db down" }).db)).toMatchObject({ ok: false, status: 503 });
  });

  it("says unavailable when the stored secret cannot be decrypted, without leaking why", async () => {
    const result = await call(fakeDb(channel({ hmacTokenEnc: "not-a-valid-ciphertext" })).db);
    expect(result).toMatchObject({ ok: false, status: 503 });
    expect(JSON.stringify(result)).not.toMatch(/decrypt|cipher|key/i);
  });
});
