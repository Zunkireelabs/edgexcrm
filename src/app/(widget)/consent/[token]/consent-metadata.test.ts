import { describe, it, expect } from "vitest";
import { buildConsentMetadata, publicLogoUrl } from "./consent-metadata";

const admizz = { name: "Admizz Education", logo_url: "https://cdn.example.com/admizz.png" };

describe("buildConsentMetadata", () => {
  it("names the document and the organisation, with a one-line description", () => {
    const m = buildConsentMetadata({ valid: true, tenant: admizz });
    expect(m.title).toBe("Student Consent Form — Admizz Education");
    expect(m.description).toBe("Please review and sign your consent form for Admizz Education.");
    expect(m.openGraph?.title).toBe("Student Consent Form — Admizz Education");
    expect(m.openGraph?.siteName).toBe("Admizz Education");
  });

  it("uses the organisation's logo as the preview image when it has a public one", () => {
    const m = buildConsentMetadata({ valid: true, tenant: admizz });
    expect(m.openGraph?.images).toEqual([{ url: "https://cdn.example.com/admizz.png", alt: "Admizz Education" }]);
    expect(m.twitter).toMatchObject({ card: "summary_large_image", images: ["https://cdn.example.com/admizz.png"] });
  });

  it("with no saved logo it is still formal and named — just without an image", () => {
    const m = buildConsentMetadata({ valid: true, tenant: { name: "Admizz Education", logo_url: null } });
    expect(m.title).toBe("Student Consent Form — Admizz Education");
    expect(m.openGraph?.images).toBeUndefined();
    expect(m.twitter).toMatchObject({ card: "summary" });
  });

  it("is never indexed — a consent link is private to one student", () => {
    expect(buildConsentMetadata({ valid: true, tenant: admizz }).robots).toEqual({ index: false, follow: false });
    expect(buildConsentMetadata({ valid: false }).robots).toEqual({ index: false, follow: false });
  });

  it("an unavailable / expired / signed link gets a plain title and says nothing about the organisation", () => {
    const m = buildConsentMetadata({ valid: false, tenant: admizz });
    expect(m.title).toBe("Student Consent Form");
    expect(m.description).toBeUndefined();
    expect(m.openGraph).toBeUndefined();
  });

  it("a valid link with a blank organisation name falls back to the plain title", () => {
    expect(buildConsentMetadata({ valid: true, tenant: { name: "   ", logo_url: null } }).title).toBe("Student Consent Form");
    expect(buildConsentMetadata({ valid: true }).title).toBe("Student Consent Form");
  });

  it("contains only the organisation's public branding — no student data can reach the preview", () => {
    const input = {
      valid: true,
      tenant: admizz,
      // The page's data also carries the consent text and tenant id; none of it may leak into the metadata.
      body_snapshot: "Student Priya Sharma, passport 11962790, Ward 14, Birgunj",
      title: "Student Consent & Authorization",
      tenant_id: "tenant-123",
    } as Parameters<typeof buildConsentMetadata>[0];
    const text = JSON.stringify(buildConsentMetadata(input));
    expect(text).not.toContain("Priya");
    expect(text).not.toContain("11962790");
    expect(text).not.toContain("Birgunj");
    expect(text).not.toContain("tenant-123");
  });
});

describe("publicLogoUrl", () => {
  it("keeps a public https or http image link", () => {
    expect(publicLogoUrl("https://cdn.example.com/a.png")).toBe("https://cdn.example.com/a.png");
    expect(publicLogoUrl("http://cdn.example.com/a.png")).toBe("http://cdn.example.com/a.png");
  });

  it("ignores blank, relative, data: and malformed values", () => {
    expect(publicLogoUrl(null)).toBeNull();
    expect(publicLogoUrl("")).toBeNull();
    expect(publicLogoUrl("   ")).toBeNull();
    expect(publicLogoUrl("/logos/admizz.png")).toBeNull();
    expect(publicLogoUrl("data:image/png;base64,AAAA")).toBeNull();
    expect(publicLogoUrl("javascript:alert(1)")).toBeNull();
    expect(publicLogoUrl("not a url")).toBeNull();
  });
});
