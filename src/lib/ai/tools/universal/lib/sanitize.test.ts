import { describe, it, expect } from "vitest";
import { z } from "zod";
import { optionalFilterString, optionalString, optionalUuid, NIL_UUID } from "./sanitize";

describe("optionalString", () => {
  const schema = z.object({ q: optionalString(z.string().max(200).optional()) });

  it("parses an empty string to undefined", () => {
    expect(schema.parse({ q: "" })).toEqual({ q: undefined });
  });

  it("parses a whitespace-only string to undefined", () => {
    expect(schema.parse({ q: "   " })).toEqual({ q: undefined });
  });

  it("leaves a real value untouched", () => {
    expect(schema.parse({ q: "priya" })).toEqual({ q: "priya" });
  });

  it("leaves omission untouched", () => {
    expect(schema.parse({})).toEqual({ q: undefined });
  });
});

describe("optionalUuid", () => {
  const schema = z.object({ id: optionalUuid(z.string().uuid().optional()) });
  const REAL_UUID = "11111111-1111-4111-8111-111111111111";

  it("parses an empty string to undefined", () => {
    expect(schema.parse({ id: "" })).toEqual({ id: undefined });
  });

  it("parses the NIL uuid to undefined", () => {
    expect(schema.parse({ id: NIL_UUID })).toEqual({ id: undefined });
  });

  it("parses the NIL uuid case-insensitively to undefined", () => {
    expect(schema.parse({ id: NIL_UUID.toUpperCase() })).toEqual({ id: undefined });
  });

  it("parses the all-Fs placeholder uuid (lowercase) to undefined", () => {
    expect(schema.parse({ id: "ffffffff-ffff-ffff-ffff-ffffffffffff" })).toEqual({ id: undefined });
  });

  it("parses the all-Fs placeholder uuid (uppercase) to undefined", () => {
    expect(schema.parse({ id: "FFFFFFFF-FFFF-FFFF-FFFF-FFFFFFFFFFFF" })).toEqual({ id: undefined });
  });

  it("parses an all-same-digit placeholder uuid to undefined", () => {
    expect(schema.parse({ id: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa" })).toEqual({ id: undefined });
  });

  it("leaves a real uuid untouched", () => {
    expect(schema.parse({ id: REAL_UUID })).toEqual({ id: REAL_UUID });
  });

  it("leaves a real random uuid untouched", () => {
    const uuid = "9f8c2e14-7b3a-4d6f-a1c9-2e5b8d0f4a71";
    expect(schema.parse({ id: uuid })).toEqual({ id: uuid });
  });

  it("still rejects a non-uuid, non-blank string", () => {
    expect(schema.safeParse({ id: "not-a-uuid" }).success).toBe(false);
  });
});

describe("optionalFilterString", () => {
  const schema = z.object({ stage: optionalFilterString(z.string().max(100).optional()) });

  it.each(["all", "ALL", "  All  ", "any", "none", "*"])("parses sentinel %j to undefined", (value) => {
    expect(schema.parse({ stage: value })).toEqual({ stage: undefined });
  });

  it("parses an empty string to undefined", () => {
    expect(schema.parse({ stage: "" })).toEqual({ stage: undefined });
  });

  it("leaves a real slug untouched", () => {
    expect(schema.parse({ stage: "qualified" })).toEqual({ stage: "qualified" });
  });

  it("does not treat a slug merely containing a sentinel word as one", () => {
    expect(schema.parse({ stage: "all-applicants" })).toEqual({ stage: "all-applicants" });
  });

  it("leaves omission untouched", () => {
    expect(schema.parse({})).toEqual({ stage: undefined });
  });
});
