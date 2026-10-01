// A sequence step's body is stored as one HTML string with no format column, so the
// editor mode ("rich" = TipTap, "html" = source + preview) is inferred from the content.
// TipTap silently drops anything its schema doesn't know (tables, <style>, inline styles),
// so a body that carries designed-email markup must open in HTML mode or it would be mangled.

export type StepBodyMode = "rich" | "html";

// What TipTap's StarterKit + Link can round-trip. A body that uses any other tag, an HTML
// comment / doctype (Outlook conditional comments), or presentational attributes is a
// designed email and must open in HTML mode.
const TIPTAP_TAGS = new Set([
  "p", "br", "strong", "b", "em", "i", "s", "a", "ul", "ol", "li",
  "h1", "h2", "h3", "h4", "h5", "h6", "blockquote", "code", "pre", "hr",
]);
const PRESENTATIONAL_ATTR = /\s(style|align|width|height|bgcolor|background|border|cellpadding|cellspacing|valign|color|face|size)\s*=/i;

export function detectBodyMode(html: string): StepBodyMode {
  if (/<!/.test(html) || PRESENTATIONAL_ATTR.test(html)) return "html";
  for (const m of html.matchAll(/<\/?\s*([a-zA-Z][\w:-]*)/g)) {
    if (!TIPTAP_TAGS.has(m[1].toLowerCase())) return "html";
  }
  return "rich";
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
