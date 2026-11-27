// The fixed branded layout for one-off emails sent from a company's NO-REPLY address: logo header, a thin colour bar, the
// message the person typed, and a plain two-line footer. Pure (no network, no database, no server-only imports), so the
// server builds the real email with it AND the browser builds the in-pop-up frame and the Preview from the very same pieces:
// what you see is what is sent.
//
// Reuses the safety helpers of the notification layout (notify/base-layout.ts): every brand value is HTML-escaped, a logo must be
// an https URL, colours must be plain hex. Only `bodyHtml` is inserted as-is, because it is the rich text the person typed.

import { DEFAULT_COLOR, FONT, escapeHtml, safeLogoUrl } from "../notify/base-layout";

export interface BrandedBrand {
  /** Company name: footer line 1, logo alt text, and the plain wordmark when there is no logo. */
  name: string;
  /** Header logo (https only). Without a valid one the name is shown as a wordmark. */
  logoUrl: string | null;
  /** Main colour (#RRGGBB): colour bar and footer. Anything else falls back to the default blue. */
  color: string | null;
  /** Accent (#RRGGBB): the short tab in the colour bar and the footer link. None when empty or invalid. */
  accent: string | null;
  /** The address in "Need help? Write to …". The line is left out when this is empty or not an email. */
  helpEmail: string | null;
}

const TEXT_COLOR = "#1A1A2E";
const HEX6 = /^#[0-9a-fA-F]{6}$/;
const HEX3 = /^#[0-9a-fA-F]{3}$/;
const EMAIL = /^[^\s@<>"']+@[^\s@<>"']+\.[^\s@<>"']+$/;

/** "#abc" -> "#AABBCC"; a valid "#RRGGBB" as-is (upper-cased); anything else null. Only these may reach a style attribute. */
export function normalizeHex(color: string | null | undefined): string | null {
  if (!color) return null;
  const c = color.trim();
  if (HEX6.test(c)) return c.toUpperCase();
  if (HEX3.test(c)) return ("#" + c.slice(1).split("").map((x) => x + x).join("")).toUpperCase();
  return null;
}

/** Relative luminance 0..1 of a "#RRGGBB" colour. */
function luminance(hex: string): number {
  const n = parseInt(hex.slice(1), 16);
  const lin = (v: number) => {
    const s = v / 255;
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * lin((n >> 16) & 255) + 0.7152 * lin((n >> 8) & 255) + 0.0722 * lin(n & 255);
}

/** White text on a dark colour, near-black on a light one, so the footer stays readable whatever colour the company picks. */
function readableOn(bg: string): { text: string; muted: string; light: boolean } {
  const dark = luminance(bg) <= 0.4;
  return dark ? { text: "#FFFFFF", muted: "#D5DBF7", light: false } : { text: "#111827", muted: "#374151", light: true };
}

function colors(brand: BrandedBrand): { color: string; accent: string | null } {
  return { color: normalizeHex(brand.color) ?? DEFAULT_COLOR.toUpperCase(), accent: normalizeHex(brand.accent) };
}

/** The header (logo) and the colour bar under it, as table rows. */
export function brandedHeaderRows(brand: BrandedBrand): string {
  const { color, accent } = colors(brand);
  const name = escapeHtml(brand.name);
  const logo = safeLogoUrl(brand.logoUrl);
  const mark = logo
    ? `<img src="${escapeHtml(logo)}" alt="${name}" height="44" style="display:block;border:0;outline:none;text-decoration:none;height:44px;width:auto;max-width:240px">`
    : `<span style="font-family:${FONT};font-size:22px;line-height:28px;font-weight:700;color:${color}">${name}</span>`;
  const bar = accent
    ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse"><tr><td width="72" height="5" bgcolor="${accent}" style="background:${accent};height:5px;line-height:5px;font-size:0">&nbsp;</td><td height="5" bgcolor="${color}" style="background:${color};height:5px;line-height:5px;font-size:0">&nbsp;</td></tr></table>`
    : `<div style="height:5px;line-height:5px;font-size:0;background:${color}">&nbsp;</div>`;
  return (
    `<tr><td class="pad" style="padding:22px 32px;background:#ffffff">${mark}</td></tr>` +
    `<tr><td style="padding:0;background:${color}">${bar}</td></tr>`
  );
}

/** The two-line footer, as one table row: the company name, and "Need help? Write to <address>" when there is one. */
export function brandedFooterRows(brand: BrandedBrand): string {
  const { color, accent } = colors(brand);
  const on = readableOn(color);
  const name = escapeHtml(brand.name);
  const help = brand.helpEmail && EMAIL.test(brand.helpEmail.trim()) ? brand.helpEmail.trim() : null;
  // The accent only colours the link when the footer is dark (a yellow link on a light footer would be unreadable).
  const link = accent && !on.light ? accent : on.text;
  const helpLine = help
    ? `<div style="margin-top:3px;font-size:13px;line-height:19px;color:${on.muted}">Need help? Write to <a href="mailto:${escapeHtml(help)}" style="color:${link};text-decoration:underline">${escapeHtml(help)}</a></div>`
    : "";
  return (
    `<tr><td class="pad" bgcolor="${color}" style="padding:22px 32px;background:${color};font-family:${FONT}">` +
    `<div style="font-size:14.5px;line-height:20px;font-weight:700;color:${on.text}">${name}</div>${helpLine}</td></tr>`
  );
}

const table = (rows: string) =>
  `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse">${rows}</table>`;

/** Header + colour bar as a stand-alone fragment (the fixed top of the frame in the New email pop-up). */
export function brandedHeaderHtml(brand: BrandedBrand): string {
  return table(brandedHeaderRows(brand));
}

/** Footer as a stand-alone fragment (the fixed bottom of the frame in the New email pop-up). */
export function brandedFooterHtml(brand: BrandedBrand): string {
  return table(brandedFooterRows(brand));
}

/** The complete email: header, the typed message, footer. `bodyHtml` is used as-is. */
export function renderBrandedMessage(input: { bodyHtml: string; brand: BrandedBrand; title?: string }): string {
  const { brand } = input;
  const { color } = colors(brand);
  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta name="color-scheme" content="light">
<title>${escapeHtml(input.title ?? brand.name)}</title>
<style>
.msg p{margin:0 0 12px}.msg ul,.msg ol{margin:0 0 12px;padding-left:22px}.msg a{color:${color}}
@media only screen and (max-width:620px){.pad{padding-left:20px!important;padding-right:20px!important}}
</style>
</head>
<body style="margin:0;padding:0;background:#EEF0F3">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#EEF0F3"><tr><td align="center" style="padding:24px 12px">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:600px;background:#ffffff;border-collapse:collapse">
${brandedHeaderRows(brand)}
<tr><td class="msg pad" style="padding:24px 32px;background:#ffffff;font-family:${FONT};font-size:15px;line-height:24px;color:${TEXT_COLOR}">${input.bodyHtml}</td></tr>
${brandedFooterRows(brand)}
</table>
</td></tr></table>
</body>
</html>`;
}
