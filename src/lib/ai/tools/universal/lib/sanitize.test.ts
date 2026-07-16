import { describe, it, expect } from "vitest";
import { z } from "zod";
import { optionalString, optionalUuid, NIL_UUID } from "./sanitize";

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

  it("leaves a real uuid untouched", () => {
    expect(schema.parse({ id: REAL_UUID })).toEqual({ id: REAL_UUID });
  });

  it("still rejects a non-uuid, non-blank string", () => {
    expect(schema.safeParse({ id: "not-a-uuid" }).success).toBe(false);
  });
});
