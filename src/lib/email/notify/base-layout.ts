/**
 * One calm, corporate HTML email shell for every notification email, so new alerts don't re-paste markup.
 * Design: plain white; a small label ("eyebrow") above a single headline; a compact label/value list; hairline
 * dividers; 4px radii; quiet greys for everything secondary; and the tenant's brand colour used in exactly two
 * places (the thin top rule and the button). Inline styles for every client; one small <style> block adds the phone
 * refinements (tighter padding, full-width button) where the client supports it. EVERY interpolated value is
 * HTML-escaped: lead data is user input and must never inject markup into an admin's inbox.
 */

export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

const DEFAULT_COLOR = "#2272B4";
/** Only a plain hex colour may reach a style attribute — anything else falls back to the default. */
function safeColor(color: string | null | undefined): string {
  return color && /^#[0-9a-fA-F]{3,8}$/.test(color) ? color : DEFAULT_COLOR;
}
/** Links must be http(s) (CTA) — anything else (javascript:, data:) is dropped. */
function safeUrl(url: string): string | null {
  try {
    const u = new URL(url);
    return u.protocol === "https:" || u.protocol === "http:" ? u.toString() : null;
  } catch {
    return null;
  }
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

export interface EmailLayoutInput {
  /** <title> and the inbox preview line. */
  title: string;
  preheader?: string;
  tenantName: string;
  primaryColor?: string | null;
  /** Small label above the headline, e.g. "New lead · New Leads". */
  eyebrow?: string;
  heading: string;
  intro?: string;
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

  const rowsHtml = rows
    .map((r) => {
      const href = safeRowHref(r.href);
      const value = escapeHtml((r.value as string).trim());
      const valueHtml = href
        ? `<a href="${escapeHtml(href)}" style="color: #111827; text-decoration: underline; text-decoration-color: #d1d5db;">${value}</a>`
        : value;
      return `
                <tr>
                  <td class="kv-label" width="92" valign="top" style="padding: 9px 12px 9px 0; font-size: 13px; line-height: 20px; color: #6b7280;">${escapeHtml(r.label)}</td>
                  <td class="kv-value" valign="top" style="padding: 9px 0; font-size: 14px; line-height: 20px; color: #111827; word-break: break-word;">${valueHtml}</td>
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
      .wrap { padding: 20px 16px !important; }
      .kv-label, .kv-value { display: block !important; width: 100% !important; }
      .kv-label { padding: 10px 0 0 0 !important; font-size: 12px !important; }
      .kv-value { padding: 2px 0 10px 0 !important; }
      .cta-link { display: block !important; text-align: center !important; padding: 14px 20px !important; }
    }
  </style>
</head>
<body style="margin: 0; padding: 0; background-color: #ffffff; font-family: ${FONT}; -webkit-font-smoothing: antialiased;">
  ${input.preheader ? `<div style="display: none; max-height: 0; overflow: hidden; opacity: 0;">${escapeHtml(input.preheader)}</div>` : ""}
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background-color: #ffffff;">
    <tr>
      <td align="center" class="wrap" style="padding: 40px 24px;">
        <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width: 540px;">
          <tr><td style="height: 2px; line-height: 2px; font-size: 0; background-color: ${color};">&nbsp;</td></tr>
          <tr>
            <td style="padding: 16px 0 0 0; font-size: 12px; font-weight: 600; letter-spacing: 0.04em; text-transform: uppercase; color: #6b7280;">${escapeHtml(input.tenantName)}</td>
          </tr>
          <tr>
            <td style="padding: 28px 0 0 0;">
              ${input.eyebrow ? `<div style="font-size: 12px; line-height: 16px; letter-spacing: 0.04em; text-transform: uppercase; color: #6b7280;">${escapeHtml(input.eyebrow)}</div>` : ""}
              <h1 style="margin: ${input.eyebrow ? "6px" : "0"} 0 0 0; font-size: 22px; line-height: 30px; font-weight: 600; letter-spacing: -0.01em; color: #111827;">${escapeHtml(input.heading)}</h1>
              ${input.intro ? `<p style="margin: 8px 0 0 0; font-size: 14px; line-height: 22px; color: #4b5563;">${escapeHtml(input.intro)}</p>` : ""}
            </td>
          </tr>
          ${
            rows.length > 0
              ? `<tr>
            <td style="padding: 22px 0 0 0;">
              <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border-top: 1px solid #e5e7eb; border-bottom: 1px solid #e5e7eb;">
                <tr><td colspan="2" style="height: 6px; line-height: 6px; font-size: 0;">&nbsp;</td></tr>${rowsHtml}
                <tr><td colspan="2" style="height: 6px; line-height: 6px; font-size: 0;">&nbsp;</td></tr>
              </table>
            </td>
          </tr>`
              : ""
          }
          ${
            input.cta && ctaUrl
              ? `<tr>
            <td style="padding: 24px 0 0 0;">
              <a href="${escapeHtml(ctaUrl)}" class="cta-link" style="display: inline-block; padding: 11px 20px; background-color: ${color}; border-radius: 4px; font-size: 14px; font-weight: 600; line-height: 20px; color: #ffffff; text-decoration: none;">${escapeHtml(input.cta.label)}</a>
              <p style="margin: 14px 0 0 0; font-size: 12px; line-height: 18px; color: #9ca3af; word-break: break-all;">${escapeHtml(ctaUrl)}</p>
            </td>
          </tr>`
              : ""
          }
          <tr>
            <td style="padding: 32px 0 0 0;">
              <div style="border-top: 1px solid #e5e7eb; padding-top: 16px; font-size: 12px; line-height: 18px; color: #9ca3af;">${input.footer ? `${escapeHtml(input.footer)}<br>` : ""}Sent automatically by EdgeX.</div>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;

  const textLines = [
    input.eyebrow ?? "",
    input.heading,
    input.intro ?? "",
    ...rows.map((r) => `${r.label}: ${(r.value as string).trim()}`),
    input.cta && ctaUrl ? `\n${input.cta.label}: ${ctaUrl}` : "",
    input.footer ? `\n${input.footer}` : "",
  ].filter((l) => l !== "");

  return { html, text: textLines.join("\n") };
}
