import { describe, it, expect } from "vitest";
import { syntheticMessageId, isSyntheticMessageId } from "./synthetic-message-id";

describe("syntheticMessageId", () => {
  it("is never null/empty and is unique per provider message id", () => {
    expect(syntheticMessageId("re_abc")).toBe("<re_abc@resend.edgex.invalid>");
    expect(syntheticMessageId("re_abc")).not.toBe(syntheticMessageId("re_def"));
  });
  it("is still unique and well-formed when there is no provider id", () => {
    const a = syntheticMessageId(null);
    const b = syntheticMessageId(undefined);
    expect(a).toMatch(/^<[0-9a-f-]{36}@resend\.edgex\.invalid>$/);
    expect(a).not.toBe(b);
  });
  it("is recognised as synthetic, and real Message-IDs are not", () => {
    expect(isSyntheticMessageId(syntheticMessageId("x"))).toBe(true);
    expect(isSyntheticMessageId("<CAF123@mail.gmail.com>")).toBe(false);
    expect(isSyntheticMessageId(null)).toBe(false);
    expect(isSyntheticMessageId(undefined)).toBe(false);
  });
});
