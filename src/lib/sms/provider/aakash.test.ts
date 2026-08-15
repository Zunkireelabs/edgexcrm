import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { aakashProvider } from "./aakash";

function mockFetchOnce(body: unknown, status = 200) {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue({
      ok: status >= 200 && status < 300,
      status,
      json: async () => body,
    })
  );
}

describe("aakashProvider.send", () => {
  beforeEach(() => {
    process.env.AAKASH_SMS_TOKEN = "test-token";
    process.env.AAKASH_SMS_BASE_URL = "https://sms.aakashsms.com";
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("maps a success response (HTTP 200, error:false) into ok:true with valid/invalid lists", async () => {
    mockFetchOnce({
      error: false,
      message: "1 messages has been queued for delivery.",
      data: {
        valid: [{ id: 2673160, mobile: "9779818000000", text: "hi", credit: 1, network: "ncell", status: "queued" }],
        invalid: [{ mobile: "988585584", text: "hi", credit: 0, network: "N/A", status: "aborted" }],
      },
    });

    const outcome = await aakashProvider().send({ to: ["9818000000"], text: "hi" });

    expect(outcome.ok).toBe(true);
    if (outcome.ok) {
      expect(outcome.result.valid).toEqual([
        { id: "2673160", mobile: "9779818000000", credit: 1, network: "ncell", status: "queued" },
      ]);
      expect(outcome.result.invalid).toEqual([{ mobile: "988585584", message: "aborted" }]);
    }
  });

  it('treats HTTP 200 + error:true "Not enough balance." as a non-retryable insufficient_balance failure', async () => {
    mockFetchOnce({ error: true, message: "Not enough balance." });

    const outcome = await aakashProvider().send({ to: ["9818000000"], text: "hi" });

    expect(outcome.ok).toBe(false);
    if (!outcome.ok) {
      expect(outcome.code).toBe("insufficient_balance");
      expect(outcome.retryable).toBe(false);
    }
  });

  it('treats HTTP 200 + error:true "The provided Auth Token is not valid." as invalid_token', async () => {
    mockFetchOnce({ error: true, message: "The provided Auth Token is not valid." });

    const outcome = await aakashProvider().send({ to: ["9818000000"], text: "hi" });

    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.code).toBe("invalid_token");
  });

  it('treats HTTP 200 + error:true "No valid recipients." as no_valid_recipients', async () => {
    mockFetchOnce({ error: true, message: "No valid recipients." });

    const outcome = await aakashProvider().send({ to: ["9818000000"], text: "hi" });

    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.code).toBe("no_valid_recipients");
  });

  it('treats HTTP 200 + error:true "All messages encountered errors." as all_failed', async () => {
    mockFetchOnce({ error: true, message: "All messages encountered errors." });

    const outcome = await aakashProvider().send({ to: ["9818000000"], text: "hi" });

    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.code).toBe("all_failed");
  });

  it("res.ok === true never short-circuits a provider-level error — the JSON error field is authoritative", async () => {
    // Explicitly construct a response where res.ok is true (status 200) AND
    // error:true, to prove the provider does not branch on res.ok.
    mockFetchOnce({ error: true, message: "Not enough balance." }, 200);
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;

    const outcome = await aakashProvider().send({ to: ["9818000000"], text: "hi" });

    const [, callArgs] = fetchMock.mock.calls[0];
    expect(callArgs).toBeDefined();
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.code).toBe("insufficient_balance");
  });

  it("treats a network throw (fetch rejection) as a retryable network failure", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("ECONNRESET")));

    const outcome = await aakashProvider().send({ to: ["9818000000"], text: "hi" });

    expect(outcome.ok).toBe(false);
    if (!outcome.ok) {
      expect(outcome.code).toBe("network");
      expect(outcome.retryable).toBe(true);
    }
  });

  it("throws when AAKASH_SMS_TOKEN is not configured", async () => {
    delete process.env.AAKASH_SMS_TOKEN;
    await expect(aakashProvider().send({ to: ["9818000000"], text: "hi" })).rejects.toThrow();
  });

  it('treats the v4 "Authentication token is invalid or expired." message as invalid_token', async () => {
    mockFetchOnce({ error: true, message: "Authentication token is invalid or expired." });

    const outcome = await aakashProvider().send({ to: ["9818000000"], text: "hi" });

    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.code).toBe("invalid_token");
  });
});

describe("aakashProvider.availableCredit", () => {
  beforeEach(() => {
    process.env.AAKASH_SMS_TOKEN = "test-token";
    process.env.AAKASH_SMS_BASE_URL = "https://sms.aakashsms.com";
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("reads the live `available_credit` field, not `credit`/`balance`", async () => {
    mockFetchOnce({ available_credit: 100000, response_code: 200 });

    const credit = await aakashProvider().availableCredit();

    expect(credit).toBe(100000);
  });
});

describe("aakashProvider.report", () => {
  beforeEach(() => {
    process.env.AAKASH_SMS_TOKEN = "test-token";
    process.env.AAKASH_SMS_BASE_URL = "https://sms.aakashsms.com";
  });

  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it("reads rows from the live nested shape data.result.data, not data", async () => {
    mockFetchOnce({
      status: "success",
      data: {
        userJobFirstRow: null,
        result: {
          current_page: 1,
          data: [{ id: "1", recipient: "9779818000000", network: "ncell", body: "hi", credit: "1", created_at: "2026-08-01 00:00:00", status: "delivered" }],
        },
      },
    });

    const rows = await aakashProvider().report("2026-08-01", "2026-08-15");

    expect(rows).toHaveLength(1);
    expect(rows[0].status).toBe("delivered");
  });
});
