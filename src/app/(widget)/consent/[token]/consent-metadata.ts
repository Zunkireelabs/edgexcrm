import type { Metadata } from "next";

// What a student sees when a consent link is pasted into WhatsApp / email / a browser tab: the title, a one-line description and
// the organisation's logo. Built ONLY from the tenant's public branding — never from the student's data — and always noindex,
// because a consent link is private to one student.

export interface ConsentMetadataInput {
  valid: boolean;
  tenant?: { name: string; logo_url: string | null };
}

const FALLBACK_TITLE = "Student Consent Form";

/** A link preview can only fetch a public http(s) image; anything else (a relative path, "data:", junk) is ignored. */
export function publicLogoUrl(logoUrl: string | null | undefined): string | null {
  const value = (logoUrl ?? "").trim();
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:" ? url.toString() : null;
  } catch {
    return null;
  }
}

export function buildConsentMetadata(data: ConsentMetadataInput): Metadata {
  const noindex = { index: false, follow: false } as const;
  const name = data.valid ? (data.tenant?.name ?? "").trim() : "";

  // An unavailable / expired / already-signed link says nothing about who it belonged to.
  if (!name) return { title: FALLBACK_TITLE, robots: noindex };

  const title = `${FALLBACK_TITLE} — ${name}`;
  const description = `Please review and sign your consent form for ${name}.`;
  const logo = publicLogoUrl(data.tenant?.logo_url);

  return {
    title,
    description,
    robots: noindex,
    openGraph: {
      title,
      description,
      siteName: name,
      type: "website",
      ...(logo ? { images: [{ url: logo, alt: name }] } : {}),
    },
    twitter: { card: logo ? "summary_large_image" : "summary", title, description, ...(logo ? { images: [logo] } : {}) },
  };
}
