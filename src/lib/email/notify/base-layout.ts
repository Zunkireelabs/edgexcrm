/**
 * One responsive HTML email shell for every notification email, so new alerts don't re-paste ~60 lines of markup.
 * Inline styles only (email clients ignore <style>), 600px max width, mobile-safe. EVERY interpolated value is
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
/** Links must be http(s); anything else (javascript:, data:) is dropped. */
function safeUrl(url: string): string | null {
  try {
    const u = new URL(url);
    return u.protocol === "https:" || u.protocol === "http:" ? u.toString() : null;
  } catch {
    return null;
  }
}

export interface EmailRow {
  label: string;
  /** Empty / nullish values are hidden. */
  value: string | null | undefined;
}

export interface EmailLayoutInput {
  /** <title> and the inbox preview line. */
  title: string;
  preheader?: string;
  tenantName: string;
  primaryColor?: string | null;
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

export function renderEmailLayout(input: EmailLayoutInput): RenderedEmail {
  const color = safeColor(input.primaryColor);
  const rows = (input.rows ?? []).filter((r) => r.value && r.value.trim());
  const ctaUrl = input.cta ? safeUrl(input.cta.url) : null;
  const initial = escapeHtml((input.tenantName.trim().charAt(0) || "E").toUpperCase());

  const rowsHtml = rows
    .map(
      (r) => `
                <tr>
                  <td style="padding: 6px 16px 6px 0; font-size: 13px; color: #888; white-space: nowrap; vertical-align: top;">${escapeHtml(r.label)}</td>
                  <td style="padding: 6px 0; font-size: 15px; color: #111; word-break: break-word;">${escapeHtml(r.value as string)}</td>
                </tr>`
    )
    .join("");

  const html = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(input.title)}</title>
</head>
<body style="margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif; background-color: #f5f5f5;">
  ${input.preheader ? `<div style="display: none; max-height: 0; overflow: hidden; opacity: 0;">${escapeHtml(input.preheader)}</div>` : ""}
  <table width="100%" cellpadding="0" cellspacing="0" style="background-color: #f5f5f5; padding: 32px 16px;">
    <tr>
      <td align="center">
        <table width="100%" cellpadding="0" cellspacing="0" style="max-width: 600px; background-color: #ffffff; border-radius: 12px; overflow: hidden; box-shadow: 0 4px 6px rgba(0, 0, 0, 0.05);">
          <tr>
            <td style="padding: 24px 32px; background-color: ${color};">
              <span style="display: inline-block; width: 36px; height: 36px; background-color: rgba(255,255,255,0.2); border-radius: 8px; text-align: center; line-height: 36px; color: #ffffff; font-weight: bold; font-size: 16px; vertical-align: middle;">${initial}</span>
              <span style="margin-left: 12px; font-size: 17px; font-weight: 600; color: #ffffff; vertical-align: middle;">${escapeHtml(input.tenantName)}</span>
            </td>
          </tr>
          <tr>
            <td style="padding: 32px;">
              <h1 style="margin: 0 0 12px 0; font-size: 22px; font-weight: 600; color: #111;">${escapeHtml(input.heading)}</h1>
              ${input.intro ? `<p style="margin: 0 0 24px 0; font-size: 15px; line-height: 24px; color: #555;">${escapeHtml(input.intro)}</p>` : ""}
              ${
                rows.length > 0
                  ? `<table width="100%" cellpadding="0" cellspacing="0" style="margin: 0 0 28px 0; background-color: #f8f9fa; border: 1px solid #eee; border-radius: 8px;">
                <tr><td style="padding: 16px 20px;">
                  <table cellpadding="0" cellspacing="0" width="100%">${rowsHtml}
                  </table>
                </td></tr>
              </table>`
                  : ""
              }
              ${
                input.cta && ctaUrl
                  ? `<table cellpadding="0" cellspacing="0" style="margin: 0 0 20px 0;">
                <tr>
                  <td style="background-color: ${color}; border-radius: 8px;">
                    <a href="${escapeHtml(ctaUrl)}" style="display: inline-block; padding: 14px 28px; font-size: 16px; font-weight: 600; color: #ffffff; text-decoration: none;">${escapeHtml(input.cta.label)}</a>
                  </td>
                </tr>
              </table>
              <p style="margin: 0; font-size: 12px; color: #aaa; line-height: 18px;">If the button doesn't work, copy this link:<br><a href="${escapeHtml(ctaUrl)}" style="color: ${color}; word-break: break-all;">${escapeHtml(ctaUrl)}</a></p>`
                  : ""
              }
            </td>
          </tr>
          <tr>
            <td style="padding: 20px 32px; background-color: #fafafa; border-top: 1px solid #eee;">
              <p style="margin: 0; font-size: 12px; color: #aaa; line-height: 18px;">${input.footer ? `${escapeHtml(input.footer)}<br>` : ""}&copy; ${new Date().getFullYear()} EdgeX by Zunkiree Labs</p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;

  const textLines = [
    input.heading,
    input.intro ?? "",
    ...rows.map((r) => `${r.label}: ${(r.value as string).trim()}`),
    input.cta && ctaUrl ? `\n${input.cta.label}: ${ctaUrl}` : "",
    input.footer ? `\n${input.footer}` : "",
  ].filter((l) => l !== "");

  return { html, text: textLines.join("\n") };
}
