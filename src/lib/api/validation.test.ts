import { describe, it, expect } from "vitest";
import { isEmail, isUUID, uuidSearchParam } from "./validation";

describe("isEmail", () => {
  it("returns null for a valid email address", () => {
    expect(isEmail()("sadin@example.com")).toBeNull();
  });

  it("returns an error message for an invalid email address", () => {
    expect(isEmail()("not-an-email")).toBe("Invalid email address");
  });
});

describe("isUUID", () => {
  it("returns null for a valid uuid", () => {
    expect(isUUID()("11111111-2222-4333-8444-555555555555")).toBeNull();
  });

  it("returns an error message for a malformed value", () => {
    expect(isUUID()("not-a-real-uuid")).toBe("Invalid UUID format");
  });
});

// uuidSearchParam — the one-line query-param guard that closes the real,
// independently-repeated production bug: a raw searchParams value fed
// straight into .eq()/.in() against a uuid column throws a raw Postgres
// 22P02 and crashes the whole request. See tasks/route.ts and deals/route.ts
// for live call sites; src/lib/filters/compile.ts's sanitizeUuidCondition is
// the equivalent guard for the filter-tree system.
describe("uuidSearchParam", () => {
  it("returns the value when it's uuid-shaped", () => {
    const sp = new URLSearchParams({ project_id: "11111111-2222-4333-8444-555555555555" });
    expect(uuidSearchParam(sp, "project_id")).toBe("11111111-2222-4333-8444-555555555555");
  });

  it("returns null for a malformed value — never a throw, never the raw string", () => {
    const sp = new URLSearchParams({ project_id: "not-a-real-uuid" });
    expect(uuidSearchParam(sp, "project_id")).toBeNull();
  });

  it("returns null when the param is absent", () => {
    const sp = new URLSearchParams();
    expect(uuidSearchParam(sp, "project_id")).toBeNull();
  });

  it("returns null for an empty-string value", () => {
    const sp = new URLSearchParams({ project_id: "" });
    expect(uuidSearchParam(sp, "project_id")).toBeNull();
  });
});
