import { describe, it, expect } from "vitest";
import { resolveFooter, DEFAULT_OPTOUT_FOOTER_TEMPLATE, composeRecipientMessage, estimateFooter, DEFAULT_TENANT_SMS_SETTINGS } from "./compose";
import { optOutUrl } from "./optout";

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

// §F2 regression coverage (BLAST-F1-F2-FIX-BRIEF.md): composeRecipientMessage
// is now pure/synchronous, taking a resolved token instead of minting its
// own — this must not change the final rendered string, and preview's
// placeholder-token estimate (estimateFooter) must not drift from a real
// send's footer shape (only the token value differs).
describe("composeRecipientMessage — pure/synchronous (§F2)", () => {
  const settings = { ...DEFAULT_TENANT_SMS_SETTINGS, optout_footer: null };

  it("renders the same string a manual resolveFooter + render would produce for the same token", () => {
    const token = "aB3dEf9k1x";
    const composed = composeRecipientMessage(settings, "Hi {{first_name}}", { lead: { first_name: "Ada" } }, token);
    expect(composed.text).toContain("Hi Ada");
    expect(composed.text).toContain(optOutUrl(token));
  });

  it("only the token differs between two recipients with an identical body", () => {
    const a = composeRecipientMessage(settings, "Hello", { lead: {} }, "aaaaaaaaaa");
    const b = composeRecipientMessage(settings, "Hello", { lead: {} }, "bbbbbbbbbb");
    expect(a.text.replace("aaaaaaaaaa", "TOKEN")).toBe(b.text.replace("bbbbbbbbbb", "TOKEN"));
  });

  it("preview's placeholder-token footer is the same length/shape as a real token's footer", () => {
    const realToken = "aB3dEf9k1x"; // same TOKEN_LENGTH (10) as a real minted token
    const real = composeRecipientMessage(settings, "Hello", { lead: {} }, realToken);
    const placeholderFooter = estimateFooter(settings.optout_footer);
    const realFooter = resolveFooter(settings.optout_footer, optOutUrl(realToken));
    expect(placeholderFooter.length).toBe(realFooter.length);
    expect(real.text.endsWith(realFooter)).toBe(true);
  });
});
