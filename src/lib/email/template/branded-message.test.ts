import { describe, it, expect } from "vitest";
import {
  brandedFooterHtml,
  brandedHeaderHtml,
  normalizeHex,
  renderBrandedMessage,
  type BrandedBrand,
} from "./branded-message";

const BRAND: BrandedBrand = {
  name: "Admizz Education",
  logoUrl: "https://cdn.example.com/logo.png",
  color: "#0D1282",
  accent: "#FDED22",
  helpEmail: "hello@admizz.com",
};
const html = (over: Partial<BrandedBrand> = {}, bodyHtml = "<p>Hello</p>") => renderBrandedMessage({ bodyHtml, brand: { ...BRAND, ...over } });

describe("normalizeHex", () => {
  it("accepts #RRGGBB and #RGB, upper-cased; rejects everything else", () => {
    expect(normalizeHex("#0d1282")).toBe("#0D1282");
    expect(normalizeHex(" #abc ")).toBe("#AABBCC");
    for (const bad of ["red", "#12", "#12345", "#1234567", "0D1282", "#0D12; background:url(x)", "", null, undefined]) {
      expect(normalizeHex(bad as string | null | undefined)).toBeNull();
    }
  });
});

describe("renderBrandedMessage: the layout", () => {
  it("puts the logo first, then the typed message, then the footer, in that order", () => {
    const out = html({}, "<p>MY-MESSAGE</p>");
    const logo = out.indexOf("https://cdn.example.com/logo.png");
    const msg = out.indexOf("MY-MESSAGE");
    const footer = out.indexOf("Need help?");
    expect(logo).toBeGreaterThan(-1);
    expect(logo).toBeLessThan(msg);
    expect(msg).toBeLessThan(footer);
  });

  it("uses the typed message exactly as given (rich text is kept), and is a complete document", () => {
    const body = '<p>Hi <strong>Sita</strong></p><ul><li>One</li></ul><a href="https://x.test">link</a>';
    const out = html({}, body);
    expect(out).toContain(body);
    expect(out.startsWith("<!DOCTYPE html>")).toBe(true);
    expect(out).toContain("</html>");
  });

  it("a 600px centred table that shrinks on a phone", () => {
    const out = html();
    expect(out).toContain('width="600"');
    expect(out).toContain("max-width:600px");
    expect(out).toContain("@media only screen and (max-width:620px)");
  });

  it("the colour bar is the main colour, with a short accent tab first", () => {
    const out = html();
    expect(out).toContain('bgcolor="#FDED22"');
    expect(out.match(/bgcolor="#0D1282"/g)?.length).toBeGreaterThanOrEqual(2); // bar + footer
  });

  it("without an accent there is no accent tab, only the main colour", () => {
    const out = html({ accent: null });
    expect(out).not.toContain("#FDED22");
    expect(out).toContain("background:#0D1282");
  });
});

describe("renderBrandedMessage: logo", () => {
  it("shows the https logo with the company name as alt text", () => {
    const out = html();
    expect(out).toContain('<img src="https://cdn.example.com/logo.png" alt="Admizz Education"');
  });

  it.each([
    ["no logo", null],
    ["an http logo (mail apps block it)", "http://cdn.example.com/logo.png"],
    ["a javascript: URL", "javascript:alert(1)"],
    ["a data: URL", "data:image/png;base64,AAAA"],
    ["garbage", "not a url"],
  ])("falls back to the company name as a wordmark for %s", (_label, logoUrl) => {
    const out = html({ logoUrl });
    expect(out).not.toContain("<img");
    expect(out).toContain(">Admizz Education</span>");
  });
});

describe("renderBrandedMessage: footer", () => {
  it("is the company name and 'Need help? Write to <address>' with a mailto link, in white on a dark colour", () => {
    const out = brandedFooterHtml(BRAND);
    expect(out).toContain("Admizz Education");
    expect(out).toContain('Need help? Write to <a href="mailto:hello@admizz.com"');
    expect(out).toContain("color:#FFFFFF");
    expect(out).toContain("color:#FDED22"); // the accent colours the link on a dark footer
  });

  it("leaves the help line out when there is no address, or it is not an email", () => {
    for (const helpEmail of [null, "", "not-an-email", 'a@b.com"><script>']) {
      expect(brandedFooterHtml({ ...BRAND, helpEmail })).not.toContain("Need help?");
    }
    expect(brandedFooterHtml({ ...BRAND, helpEmail: null })).toContain("Admizz Education");
  });

  it("stays readable on a light colour: dark text, and the accent is not used for the link", () => {
    const out = brandedFooterHtml({ ...BRAND, color: "#FFE066", accent: "#FDED22" });
    expect(out).toContain("color:#111827");
    expect(out).not.toContain("color:#FFFFFF");
    expect(out).not.toMatch(/<a [^>]*color:#FDED22/);
  });
});

describe("renderBrandedMessage: nothing a company or lead types can break out of the layout", () => {
  it("escapes the name everywhere", () => {
    const out = html({ name: '<script>alert(1)</script>"' , logoUrl: null });
    expect(out).not.toContain("<script>alert(1)</script>");
    expect(out).toContain("&lt;script&gt;");
  });

  it("escapes the help address", () => {
    const out = brandedFooterHtml({ ...BRAND, helpEmail: "a&b@x.com" });
    expect(out).toContain("a&amp;b@x.com");
  });

  it("an attribute-breaking logo URL cannot inject markup", () => {
    const out = html({ logoUrl: 'https://x.test/a.png"><script>alert(1)</script>' });
    expect(out).not.toContain("<script>alert(1)</script>");
  });

  it("an invalid colour never reaches a style attribute: the default blue is used", () => {
    const out = html({ color: "red;background:url(javascript:alert(1))", accent: "#12; x" });
    expect(out).not.toContain("javascript:");
    expect(out).not.toContain("red;");
    expect(out).toContain("#0A6CFF");
  });
});

describe("fragments for the pop-up", () => {
  it("header and footer are stand-alone tables, not documents", () => {
    for (const frag of [brandedHeaderHtml(BRAND), brandedFooterHtml(BRAND)]) {
      expect(frag.startsWith("<table")).toBe(true);
      expect(frag).not.toContain("<html");
      expect(frag).not.toContain("<body");
    }
  });

  it("they are the same pieces the sent email contains", () => {
    const sent = html();
    const hdr = brandedHeaderHtml(BRAND).replace(/^<table[^>]*>/, "").replace(/<\/table>$/, "");
    const ftr = brandedFooterHtml(BRAND).replace(/^<table[^>]*>/, "").replace(/<\/table>$/, "");
    expect(sent).toContain(hdr);
    expect(sent).toContain(ftr);
  });
});
