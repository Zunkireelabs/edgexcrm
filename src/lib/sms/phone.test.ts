import { describe, it, expect } from "vitest";
import { toProviderRecipient } from "./phone";

// Real-world shapes per supabase/migrations/158_normalize_lead_phone_format.sql
describe("toProviderRecipient", () => {
  it("accepts canonical dash-separated Nepal number", () => {
    expect(toProviderRecipient("+977-9803023768")).toEqual({ ok: true, msisdn: "9803023768" });
  });

  it("accepts +977 without a dash", () => {
    expect(toProviderRecipient("+9779803023768")).toEqual({ ok: true, msisdn: "9803023768" });
  });

  it("accepts a bare 10-digit Nepal mobile", () => {
    expect(toProviderRecipient("9803023768")).toEqual({ ok: true, msisdn: "9803023768" });
  });

  it("accepts a 98-prefixed Nepal mobile", () => {
    expect(toProviderRecipient("+977-9863826770")).toEqual({ ok: true, msisdn: "9863826770" });
  });

  it("rejects a foreign +91 number", () => {
    expect(toProviderRecipient("+91-9876543210")).toEqual({ ok: false, reason: "foreign" });
  });

  it("rejects a foreign +880 number", () => {
    expect(toProviderRecipient("+880-1712345678")).toEqual({ ok: false, reason: "foreign" });
  });

  it("rejects null/empty as missing", () => {
    expect(toProviderRecipient(null)).toEqual({ ok: false, reason: "missing" });
    expect(toProviderRecipient("")).toEqual({ ok: false, reason: "missing" });
  });

  it("rejects junk / non-10-digit local numbers as malformed", () => {
    expect(toProviderRecipient("+977-12345").ok).toBe(false);
    expect(toProviderRecipient("not-a-phone").ok).toBe(false);
  });
});
