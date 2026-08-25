import { describe, it, expect } from "vitest";
import { resolveFooter, DEFAULT_OPTOUT_FOOTER_TEMPLATE } from "./compose";

describe("resolveFooter", () => {
  const url = "edgex.zunkireelabs.com/u/aB3dEf9k";

  it("falls back to the default template when the tenant has never configured one (null)", () => {
    expect(resolveFooter(null, url)).toBe(DEFAULT_OPTOUT_FOOTER_TEMPLATE.replace("{url}", url));
  });

  it("sends with no footer when an admin deliberately clears the setting (empty string)", () => {
    expect(resolveFooter("", url)).toBe("");
    expect(resolveFooter("   ", url)).toBe("");
  });

  it("substitutes {url} into a custom template", () => {
    expect(resolveFooter("Unsubscribe: {url}", url)).toBe(`Unsubscribe: ${url}`);
  });

  it("appends the url when a custom template omits the {url} placeholder", () => {
    expect(resolveFooter("Unsubscribe", url)).toBe(`Unsubscribe ${url}`);
  });
});
