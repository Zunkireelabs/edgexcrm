import type { Lead, FormConfig } from "@/types/database";

/**
 * Convert newlines that sit within plain text into <br> so they survive as
 * visible line breaks in an HTML email (raw \n collapses to nothing in
 * HTML). A newline that already sits directly against a tag boundary
 * (immediately after ">" or immediately before "<") is left untouched —
 * that's structural whitespace an admin's own pretty-printed HTML put there
 * between tags, and HTML already treats it as insignificant, so converting
 * it would inject a visible extra gap into a real design.
 *
 * Deliberately a per-newline decision, not a whole-string "is this HTML or
 * plain text" classification: an earlier version tried to classify the
 * entire message and go all-or-nothing, which both misfired on ordinary
 * text (e.g. "John <john@example.com>", "section <a> of the agreement")
 * and — worse — meant a message that mixed plain paragraphs with a little
 * inline HTML (a <b>, a link) lost ALL of its line breaks, not just the
 * ones next to the tag. Deciding per newline via its immediate neighbors
 * needs no knowledge of HTML tag names at all, so neither failure mode is
 * possible: a plain paragraph's breaks are preserved as <br> even if the
 * message elsewhere contains real markup, and a fully pasted HTML document's
 * structural whitespace between tags is left alone regardless of which tags
 * it uses.
 *
 * One narrow, deliberate trade-off remains: a newline immediately before a
 * "<...>"-shaped span (e.g. a line that starts with a bracketed URL like
 * "<www.example.com>") is conservatively left alone, same as it would be
 * before a real tag — there's no way to tell those apart without bringing
 * back a tag-name allowlist, which is exactly the whack-a-mole this
 * function was rewritten to avoid. In practice this only affects that one
 * adjacent newline, never the rest of the message, so a paragraph that
 * happens to start a line with a bracketed reference loses just that one
 * line break rather than losing all of them.
 */
export function preserveLineBreaks(html: string): string {
  return html.replace(/\r\n|\r|\n/g, (match, offset: number, str: string) => {
    const before = str[offset - 1];
    const after = str[offset + match.length];
    if (before === ">" || after === "<") return match;
    return "<br>";
  });
}

function htmlEscape(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * Replace {{token}} placeholders in a template string.
 *
 * Lookup precedence (lowest → highest):
 *   lead.custom_fields → standard lead columns → tenant_name → extra
 *
 * Missing/empty token → empty string (never leaves raw {{token}} in output).
 * opts.escape: HTML-escape each substituted value (not the template itself).
 */
export function renderTemplate(
  template: string,
  ctx: {
    lead: Lead;
    tenant?: { name?: string };
    formConfig?: FormConfig;
    extra?: Record<string, unknown>;
  },
  opts?: { escape?: boolean }
): string {
  const vars: Record<string, string> = {};

  // Base layer: custom_fields
  const cf = (ctx.lead.custom_fields ?? {}) as Record<string, unknown>;
  for (const [k, v] of Object.entries(cf)) {
    vars[k] = v != null ? String(v) : "";
  }

  // Standard lead columns override custom_fields on key collision
  vars.first_name = ctx.lead.first_name ?? "";
  vars.last_name = ctx.lead.last_name ?? "";
  vars.email = ctx.lead.email ?? "";
  vars.phone = ctx.lead.phone ?? "";
  vars.city = ctx.lead.city ?? "";
  vars.country = ctx.lead.country ?? "";

  // Tenant name
  vars.tenant_name = ctx.tenant?.name ?? "";

  // Extra tokens (highest priority)
  if (ctx.extra) {
    for (const [k, v] of Object.entries(ctx.extra)) {
      vars[k] = v != null ? String(v) : "";
    }
  }

  return template.replace(/\{\{(\w+)\}\}/g, (_match, key: string) => {
    const value = vars[key] ?? "";
    return opts?.escape ? htmlEscape(value) : value;
  });
}
