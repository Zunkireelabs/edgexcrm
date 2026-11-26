import { describe, it, expect } from "vitest";
import { DEFAULT_SOURCE_OPTIONS, cleanOptionLabel, isSourceKind, mergeSourceOptions, slugifyOption } from "./source-options";

describe("slugifyOption", () => {
  it("makes a stable lowercase slug", () => {
    expect(slugifyOption("Facebook Page #2")).toBe("facebook_page_2");
    expect(slugifyOption("  TikTok  ")).toBe("tiktok");
    expect(slugifyOption("Café / Étude")).toBe("cafe_etude");
  });
  it("is empty when nothing usable is left", () => {
    expect(slugifyOption("***")).toBe("");
  });
});

describe("cleanOptionLabel", () => {
  it("trims and collapses spaces", () => {
    expect(cleanOptionLabel("  Radio   Nepal ")).toBe("Radio Nepal");
  });
  it("rejects empty, non-text and over-long labels", () => {
    expect(cleanOptionLabel("   ")).toBe("");
    expect(cleanOptionLabel(42)).toBe("");
    expect(cleanOptionLabel("x".repeat(61))).toBe("");
  });
});

describe("mergeSourceOptions", () => {
  it("starts with the defaults, then the tenant's additions", () => {
    const out = mergeSourceOptions("category", [{ value: "radio", label: "Radio" }]);
    expect(out.slice(0, DEFAULT_SOURCE_OPTIONS.category.length)).toEqual([...DEFAULT_SOURCE_OPTIONS.category]);
    expect(out[out.length - 1]).toEqual({ value: "radio", label: "Radio" });
  });
  it("never lists a value or a label twice, ignoring case", () => {
    const out = mergeSourceOptions("category", [{ value: "GOOGLE", label: "Something" }, { value: "g2", label: "google" }]);
    expect(out.filter((o) => o.value.toLowerCase() === "google")).toHaveLength(1);
    expect(out.filter((o) => o.label.toLowerCase() === "google")).toHaveLength(1);
  });
  it("account has no starting options", () => {
    expect(mergeSourceOptions("account")).toEqual([]);
  });
  it("the starting values are the ones the system already writes", () => {
    const values = (k: "category" | "channel") => DEFAULT_SOURCE_OPTIONS[k].map((o) => o.value);
    expect(values("channel")).toEqual(expect.arrayContaining(["check_in", "dashboard", "chat"]));
    expect(values("category")).toEqual(expect.arrayContaining(["google", "referral", "social_media", "trade_show", "walk_in"]));
  });
});

describe("isSourceKind", () => {
  it("only the three lists", () => {
    expect(isSourceKind("category")).toBe(true);
    expect(isSourceKind("channel")).toBe(true);
    expect(isSourceKind("account")).toBe(true);
    expect(isSourceKind("campaign")).toBe(false);
    expect(isSourceKind(undefined)).toBe(false);
  });
});
