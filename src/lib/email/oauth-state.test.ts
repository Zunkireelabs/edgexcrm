import { describe, it, expect, beforeEach } from "vitest";
import { signState, verifyState, isOAuthStateSecretConfigured } from "./oauth-state";

const USER_ID = "user-123";

beforeEach(() => {
  process.env.NEXTAUTH_SECRET = "a".repeat(64);
});

describe("isOAuthStateSecretConfigured", () => {
  it("true when NEXTAUTH_SECRET is set", () => {
    expect(isOAuthStateSecretConfigured()).toBe(true);
  });

  it("false when NEXTAUTH_SECRET is unset", () => {
    delete process.env.NEXTAUTH_SECRET;
    expect(isOAuthStateSecretConfigured()).toBe(false);
  });

  it("false when NEXTAUTH_SECRET is an empty string", () => {
    process.env.NEXTAUTH_SECRET = "";
    expect(isOAuthStateSecretConfigured()).toBe(false);
  });
});

describe("signState / verifyState", () => {
  it("round-trips when the secret is set", () => {
    const state = signState(USER_ID);
    expect(verifyState(state, USER_ID)).toBe(true);
  });

  it("fails verification for a different userId", () => {
    const state = signState(USER_ID);
    expect(verifyState(state, "someone-else")).toBe(false);
  });

  it("fails verification for a malformed state (no separator)", () => {
    expect(verifyState("garbage", USER_ID)).toBe(false);
  });

  it("fails verification for a tampered signature", () => {
    const state = signState(USER_ID);
    const [uid] = state.split(".");
    expect(verifyState(`${uid}.deadbeefdeadbeef`, USER_ID)).toBe(false);
  });

  it("throws (fail-closed) from signState when NEXTAUTH_SECRET is unset — no fallback", () => {
    delete process.env.NEXTAUTH_SECRET;
    expect(() => signState(USER_ID)).toThrow();
  });

  it("returns false (fail-closed, never throws) from verifyState when NEXTAUTH_SECRET is unset", () => {
    const state = signState(USER_ID);
    delete process.env.NEXTAUTH_SECRET;
    expect(verifyState(state, USER_ID)).toBe(false);
  });

  it("a state signed under a different secret fails verification (rotation / mismatch)", () => {
    const state = signState(USER_ID);
    process.env.NEXTAUTH_SECRET = "b".repeat(64);
    expect(verifyState(state, USER_ID)).toBe(false);
  });

  it("never uses NEXT_PUBLIC_SUPABASE_ANON_KEY as a fallback even when it is set", () => {
    delete process.env.NEXTAUTH_SECRET;
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = "public-anon-key-not-a-secret";
    expect(() => signState(USER_ID)).toThrow();
    expect(isOAuthStateSecretConfigured()).toBe(false);
    delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  });
});
