// A sequence step's body is stored as one HTML string with no format column, so the
// editor mode ("rich" = TipTap, "html" = source + preview) is inferred from the content.
// TipTap silently drops anything its schema doesn't know (tables, <style>, inline styles),
// so a body that carries designed-email markup must open in HTML mode or it would be mangled.

export type StepBodyMode = "rich" | "html";

// Markup TipTap's StarterKit can't round-trip. Plain TipTap output (p, strong, em, a, ul/ol/li,
// br, h1-h6, blockquote, code/pre, hr) never contains any of these.
const DESIGNED_HTML = /<\s*(html|head|body|style|table|img|div|span|center|font|section|td|tr)\b|\sstyle\s*=/i;

export function detectBodyMode(html: string): StepBodyMode {
  return DESIGNED_HTML.test(html) ? "html" : "rich";
}

const SAMPLE_VALUES: Record<string, string> = {
  first_name: "Jane",
  last_name: "Doe",
  email: "jane.doe@example.com",
  phone: "+1 555 010 0199",
  city: "Sydney",
  country: "Australia",
  tenant_name: "Your Organisation",
};

/** Fills {{merge_tags}} with fixed sample values for preview only. Unknown tags become empty, like the real renderer. */
export function fillSampleMergeTags(html: string): string {
  return html.replace(/\{\{(\w+)\}\}/g, (_m, key: string) => SAMPLE_VALUES[key] ?? "");
}
