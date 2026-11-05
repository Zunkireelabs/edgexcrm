/**
 * One calm, corporate HTML email shell for every notification email, so new alerts don't re-paste markup.
 *
 * Anatomy (top to bottom): the product LOGO (or a text wordmark) · a small tinted TAG · a big bold HEADLINE ·
 * ONE plain sentence (the "lede") · a soft grey DETAILS card · ONE button · a soft grey FOOTER panel.
 * The accent colour is used only for the tag and the button. Inline styles for every client; one small
 * <style> block adds the phone refinements (tighter padding, stacked details, full-width button) where supported.
 * EVERY interpolated value is HTML-escaped: lead data is user input and must never inject markup into an inbox.
 */

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

const DEFAULT_COLOR = "#0A6CFF"; // EdgeX blue
/** Only a plain hex colour may reach a style attribute — anything else falls back to the default. */
function safeColor(color: string | null | undefined): string {
  return color && /^#[0-9a-fA-F]{3,8}$/.test(color) ? color : DEFAULT_COLOR;
}
/** "#2272B4" -> "rgba(34,114,180,0.1)" (a soft tint for the tag background). */
function tint(hex: string, alpha: number): string {
  let h = hex.replace("#", "");
  if (h.length === 3 || h.length === 4) h = h.split("").map((c) => c + c).join("");
  const n = parseInt(h.slice(0, 6), 16);
  if (Number.isNaN(n) || h.length < 6) return `rgba(10,108,255,${alpha})`;
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${alpha})`;
}
/** Links must be http(s) (CTA, logo) — anything else (javascript:, data:) is dropped. */
function safeUrl(url: string): string | null {
  try {
    const u = new URL(url);
    return u.protocol === "https:" || u.protocol === "http:" ? u.toString() : null;
  } catch {
    return null;
  }
}
/** A logo must be https (mail clients block or warn on http images). */
function safeLogoUrl(url: string | null | undefined): string | null {
  if (!url) return null;
  const u = safeUrl(url);
  return u && u.startsWith("https://") ? u : null;
}
/** Row links additionally allow mailto: and tel: so an email / phone is one tap away. */
function safeRowHref(href: string | null | undefined): string | null {
  if (!href) return null;
  if (/^mailto:[^\s<>"']+$/i.test(href) || /^tel:\+?[0-9]+$/i.test(href)) return href;
  return safeUrl(href);
}

export interface EmailRow {
  label: string;
  /** Empty / nullish values are hidden. */
  value: string | null | undefined;
  /** Optional tap target (mailto:, tel:, https:). Ignored if it isn't one of those. */
  href?: string | null;
}

/** One piece of the lede sentence; `bold` pieces are emphasised. */
export interface LedeSegment {
  text: string;
  bold?: boolean;
}

export interface EmailLayoutInput {
  /** <title> and the inbox preview line. */
  title: string;
  preheader?: string;
  tenantName: string;
  /** Header logo (https URL + alt text). Without one, the tenant name is shown as a plain wordmark. */
  logo?: { url: string; alt: string } | null;
  /** Accent colour (tag + button), plain hex; default EdgeX blue-ish. */
  primaryColor?: string | null;
  /** Small tinted tag above the headline, e.g. "New lead". */
  eyebrow?: string;
  heading: string;
  /** The one plain sentence under the headline. */
  lede?: LedeSegment[];
  /** Details card rows (empty values are hidden). */
  rows?: EmailRow[];
  cta?: { label: string; url: string };
  /** Plain footer sentence, e.g. why the recipient got this. */
  footer?: string;
}

export interface RenderedEmail {
  html: string;
  text: string;
}

const FONT = "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif";

export function renderEmailLayout(input: EmailLayoutInput): RenderedEmail {
  const color = safeColor(input.primaryColor);
  const rows = (input.rows ?? []).filter((r) => r.value && r.value.trim());
  const ctaUrl = input.cta ? safeUrl(input.cta.url) : null;
  const logoSrc = safeLogoUrl(input.logo?.url);
  const lede = (input.lede ?? []).filter((seg) => seg.text);

  const brandHtml = logoSrc
    ? `<table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
                <td align="left" valign="middle"><img src="${escapeHtml(logoSrc)}" alt="${escapeHtml(input.logo?.alt || input.tenantName)}" height="44" style="display: block; height: 44px; width: auto; max-width: 200px; border: 0;"></td>
                <td align="right" valign="middle" style="padding-left: 16px; font-size: 13px; line-height: 18px; color: #6b7280;">${escapeHtml(input.tenantName)}</td>
              </tr></table>`
    : `<div style="font-size: 18px; font-weight: 700; letter-spacing: -0.01em; color: #111827;">${escapeHtml(input.tenantName)}</div>`;

  const ledeHtml = lede
    .map((seg) => (seg.bold ? `<strong style="color: #111827; font-weight: 600;">${escapeHtml(seg.text)}</strong>` : escapeHtml(seg.text)))
    .join("");

  const rowsHtml = rows
    .map((r, i) => {
      const href = safeRowHref(r.href);
      const value = escapeHtml((r.value as string).trim());
      const valueHtml = href
        ? `<a href="${escapeHtml(href)}" style="color: #111827; text-decoration: underline; text-decoration-color: #d1d5db;">${value}</a>`
        : value;
      return `
                <tr>
                  <td class="kv-label" width="96" valign="top" style="padding: 11px 12px 11px 0; ${i > 0 ? "border-top: 1px solid #eceef1;" : ""} font-size: 14px; line-height: 22px; color: #6b7280;">${escapeHtml(r.label)}</td>
                  <td class="kv-value" valign="top" style="padding: 11px 0; ${i > 0 ? "border-top: 1px solid #eceef1;" : ""} font-size: 15px; line-height: 22px; color: #111827; word-break: break-word;">${valueHtml}</td>
                </tr>`;
    })
    .join("");

  const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta name="color-scheme" content="light">
  <title>${escapeHtml(input.title)}</title>
  <style>
    @media only screen and (max-width: 480px) {
      .wrap { padding: 24px 20px !important; }
      .title { font-size: 24px !important; line-height: 32px !important; }
      .kv-label, .kv-value { display: block !important; width: 100% !important; }
      .kv-label { padding: 12px 0 0 0 !important; border-top: 0 !important; font-size: 12px !important; line-height: 18px !important; }
      .kv-value { padding: 2px 0 12px 0 !important; border-top: 0 !important; }
      .cta-link { display: block !important; text-align: center !important; padding: 15px 20px !important; }
    }
  </style>
</head>
<body style="margin: 0; padding: 0; background-color: #ffffff; font-family: ${FONT}; -webkit-font-smoothing: antialiased;">
  ${input.preheader ? `<div style="display: none; max-height: 0; overflow: hidden; opacity: 0;">${escapeHtml(input.preheader)}</div>` : ""}
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color: #ffffff;">
    <tr>
      <td align="center" class="wrap" style="padding: 40px 24px;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width: 560px;">
          <tr>
            <td style="padding: 0 0 40px 0;">${brandHtml}</td>
          </tr>
          <tr>
            <td>
              ${input.eyebrow ? `<span style="display: inline-block; padding: 4px 10px; border-radius: 999px; background-color: ${tint(color, 0.1)}; color: ${color}; font-size: 12px; font-weight: 600; line-height: 16px; letter-spacing: 0.04em; text-transform: uppercase;">${escapeHtml(input.eyebrow)}</span>` : ""}
              <h1 class="title" style="margin: ${input.eyebrow ? "14px" : "0"} 0 0 0; font-size: 28px; line-height: 36px; font-weight: 700; letter-spacing: -0.02em; color: #111827; word-break: break-word;">${escapeHtml(input.heading)}</h1>
              ${ledeHtml ? `<p style="margin: 12px 0 0 0; font-size: 16px; line-height: 26px; color: #4b5563;">${ledeHtml}</p>` : ""}
            </td>
          </tr>
          ${
            rows.length > 0
              ? `<tr>
            <td style="padding: 28px 0 0 0;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color: #f7f8fa; border-radius: 12px;">
                <tr><td style="padding: 6px 22px;">
                  <table role="presentation" width="100%" cellpadding="0" cellspacing="0">${rowsHtml}
                  </table>
                </td></tr>
              </table>
            </td>
          </tr>`
              : ""
          }
          ${
            input.cta && ctaUrl
              ? `<tr>
            <td style="padding: 28px 0 0 0;">
              <a href="${escapeHtml(ctaUrl)}" class="cta-link" style="display: inline-block; padding: 13px 24px; background-color: ${color}; border-radius: 8px; font-size: 15px; font-weight: 600; line-height: 20px; color: #ffffff; text-decoration: none;">${escapeHtml(input.cta.label)}</a>
            </td>
          </tr>`
              : ""
          }
          <tr>
            <td style="padding: 40px 0 0 0;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color: #f7f8fa; border-radius: 12px;">
                <tr><td style="padding: 18px 22px; font-size: 12px; line-height: 19px; color: #9ca3af;">${input.footer ? `${escapeHtml(input.footer)}<br>` : ""}Sent automatically by EdgeX.</td></tr>
              </table>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;

  const ledeText = lede.map((seg) => seg.text).join("");
  const textLines = [
    input.eyebrow ?? "",
    input.heading,
    ledeText,
    ...rows.map((r) => `${r.label}: ${(r.value as string).trim()}`),
    input.cta && ctaUrl ? `\n${input.cta.label}: ${ctaUrl}` : "",
    input.footer ? `\n${input.footer}` : "",
  ].filter((l) => l !== "");

  return { html, text: textLines.join("\n") };
}
