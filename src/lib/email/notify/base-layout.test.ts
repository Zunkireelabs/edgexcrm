import { describe, it, expect } from "vitest";
import { escapeHtml, renderEmailLayout } from "./base-layout";

const base = { title: "T", tenantName: "Admizz", heading: "New lead" };

describe("escapeHtml", () => {
  it("escapes the five HTML-significant characters", () => {
    expect(escapeHtml(`<a href="x">&'</a>`)).toBe("&lt;a href=&quot;x&quot;&gt;&amp;&#39;&lt;/a&gt;");
  });
});

describe("renderEmailLayout", () => {
  it("escapes user-controlled values everywhere (no markup injection into the inbox)", () => {
    const { html, text } = renderEmailLayout({
      ...base,
      tenantName: "<b>Evil</b>",
      heading: "<script>alert(1)</script>",
      rows: [{ label: "Name", value: `<img src=x onerror=alert(1)>` }],
    });
    expect(html).not.toContain("<script>");
    expect(html).not.toContain("<img src=x");
    expect(html).toContain("&lt;script&gt;");
    expect(html).toContain("&lt;img src=x onerror=alert(1)&gt;");
    expect(text).toContain("<img src=x onerror=alert(1)>"); // plain text is not HTML — kept verbatim
  });

  it("renders the CTA button and a copy-paste link for an https URL", () => {
    const { html, text } = renderEmailLayout({ ...base, cta: { label: "Open lead", url: "https://edgex.example/leads/1" } });
    expect(html).toContain('href="https://edgex.example/leads/1"');
    expect(html).toContain("Open lead");
    expect(text).toContain("Open lead: https://edgex.example/leads/1");
  });

  it("drops a non-http(s) link instead of emitting it", () => {
    const { html } = renderEmailLayout({ ...base, cta: { label: "Go", url: "javascript:alert(1)" } });
    expect(html).not.toContain("javascript:");
    expect(html).not.toContain(">Go<");
  });

  it("hides rows with empty values and renders fine without any optional field", () => {
    const { html } = renderEmailLayout({
      ...base,
      rows: [{ label: "Phone", value: "  " }, { label: "Email", value: null }, { label: "Name", value: "Ada" }],
    });
    expect(html).toContain("Ada");
    expect(html).not.toContain("Phone");
    expect(html).not.toContain(">Email<");
    expect(() => renderEmailLayout(base)).not.toThrow();
  });

  it("falls back to the default colour when the tenant colour is not a plain hex value", () => {
    const { html } = renderEmailLayout({ ...base, primaryColor: "red;background:url(x)" });
    expect(html).toContain("#2272B4");
    expect(html).not.toContain("url(x)");
  });

  it("uses a valid tenant colour", () => {
    expect(renderEmailLayout({ ...base, primaryColor: "#112233" }).html).toContain("#112233");
  });

  it("row links: mailto: and tel: are allowed, javascript: / data: are not", () => {
    const { html } = renderEmailLayout({
      ...base,
      rows: [
        { label: "Email", value: "a@b.com", href: "mailto:a@b.com" },
        { label: "Phone", value: "+9771", href: "tel:+9771" },
        { label: "Evil", value: "x", href: "javascript:alert(1)" },
        { label: "Evil2", value: "y", href: "data:text/html,<b>" },
      ],
    });
    expect(html).toContain('href="mailto:a@b.com"');
    expect(html).toContain('href="tel:+9771"');
    expect(html).not.toContain("javascript:");
    expect(html).not.toContain("data:text");
  });

  it("uses the brand colour sparingly: only the top rule and the button", () => {
    const { html } = renderEmailLayout({ ...base, primaryColor: "#112233", cta: { label: "Go", url: "https://x.test/y" } });
    expect(html.split("#112233").length - 1).toBe(2);
  });

  it("ships the phone refinements (full-width button, tighter padding) as a media query", () => {
    expect(renderEmailLayout(base).html).toContain("@media only screen and (max-width: 480px)");
  });

  it("shows the CTA as a button only — no raw URL text that an email client would auto-link in its own colour (the plain-text part keeps the link)", () => {
    const { html, text } = renderEmailLayout({ ...base, cta: { label: "Open", url: "https://edgex.test/leads/1" } });
    expect(html.split("https://edgex.test/leads/1").length - 1).toBe(1); // only the button's href
    expect(text).toContain("Open: https://edgex.test/leads/1");
  });
});
