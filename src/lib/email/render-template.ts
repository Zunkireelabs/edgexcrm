import type { Lead, FormConfig } from "@/types/database";

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
