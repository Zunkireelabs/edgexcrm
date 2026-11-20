// Website chat settings: what an admin can change, the rules for each value, and how they map to
// Chatwoot's web widget. Pure functions only (no network, no database), so every rule is unit-tested.
//
// Decisions (v1): the bubble colour is one of a fixed set of brand colours, file uploads are always
// off (EdgeX cannot show attachments yet), the message box is always shown (it is built into
// Chatwoot's pre-chat form and cannot be removed). Business hours, photos and branding are not here.

export const BRAND_COLORS = [
  { id: "blue", label: "Blue", hex: "#1F93FF" },
  { id: "indigo", label: "Indigo", hex: "#4F46E5" },
  { id: "teal", label: "Teal", hex: "#0D9488" },
  { id: "green", label: "Green", hex: "#16A34A" },
  { id: "orange", label: "Orange", hex: "#EA580C" },
  { id: "red", label: "Red", hex: "#DC2626" },
  { id: "slate", label: "Slate", hex: "#334155" },
] as const;

export type BrandColorId = (typeof BRAND_COLORS)[number]["id"];

export const REPLY_TIMES = ["in_a_few_minutes", "in_a_few_hours", "in_a_day"] as const;
export type ReplyTime = (typeof REPLY_TIMES)[number];

export const FORM_FIELD_KEYS = ["name", "phone", "email"] as const;
export type FormFieldKey = (typeof FORM_FIELD_KEYS)[number];

export interface FormFieldSetting {
  show: boolean;
  required: boolean;
}

export interface WebsiteChatSettings {
  /** The one site allowed to show the bubble, stored as a bare host, e.g. "admizzeducation.com". */
  websiteHost: string;
  color: BrandColorId;
  title: string;
  tagline: string;
  replyTime: ReplyTime;
  formIntro: string;
  fields: Record<FormFieldKey, FormFieldSetting>;
}

export const DEFAULT_WEBSITE_CHAT_SETTINGS: Omit<WebsiteChatSettings, "websiteHost"> = {
  color: "blue",
  title: "Chat with us",
  tagline: "Ask us anything",
  replyTime: "in_a_few_minutes",
  formIntro: "Give the team a way to reach you, so we can follow up.",
  fields: {
    name: { show: true, required: true },
    phone: { show: true, required: true },
    email: { show: true, required: false },
  },
};

const MAX_TITLE = 60;
const MAX_TAGLINE = 120;
const MAX_INTRO = 200;

/** A bare host such as "example.com" or "www.example.co.uk". No scheme, port, path or spaces. */
const HOST_PATTERN = /^(?=.{1,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;

/**
 * Accepts what an admin is likely to paste ("https://www.example.com/page") and reduces it to the host.
 * Returns null when it is not a valid public host.
 */
export function normalizeWebsiteHost(input: string): string | null {
  const trimmed = input.trim().toLowerCase();
  if (!trimmed) return null;
  let host = trimmed;
  if (/^[a-z][a-z0-9+.-]*:\/\//.test(trimmed)) {
    try {
      const url = new URL(trimmed);
      if (url.protocol !== "https:" && url.protocol !== "http:") return null;
      host = url.hostname;
    } catch {
      return null;
    }
  } else {
    host = trimmed.split(/[/?#]/)[0];
  }
  return HOST_PATTERN.test(host) ? host : null;
}

export type SettingsErrors = Record<string, string[]>;

function readText(value: unknown, field: string, max: number, errors: SettingsErrors, allowEmpty = false): string | undefined {
  if (value === undefined) return undefined;
  if (typeof value !== "string") {
    errors[field] = ["Must be text"];
    return undefined;
  }
  const text = value.trim();
  if (!allowEmpty && !text) {
    errors[field] = ["Required"];
    return undefined;
  }
  if (text.length > max) {
    errors[field] = [`Must be ${max} characters or fewer`];
    return undefined;
  }
  return text;
}

/**
 * Merges an admin's partial change onto the current settings and validates it. Only the fields
 * that were sent change, so saving one never resets another. Returns the errors per field, or the
 * merged result.
 */
export function mergeWebsiteChatSettings(
  current: WebsiteChatSettings,
  input: unknown
): { ok: true; settings: WebsiteChatSettings } | { ok: false; errors: SettingsErrors } {
  const errors: SettingsErrors = {};
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return { ok: false, errors: { body: ["Request body must be a JSON object"] } };
  }
  const b = input as Record<string, unknown>;
  const next: WebsiteChatSettings = { ...current, fields: { ...current.fields } };

  if (b.websiteHost !== undefined) {
    const host = typeof b.websiteHost === "string" ? normalizeWebsiteHost(b.websiteHost) : null;
    if (host) next.websiteHost = host;
    else errors.websiteHost = ["Enter your website address, for example example.com"];
  }

  if (b.color !== undefined) {
    if (BRAND_COLORS.some((c) => c.id === b.color)) next.color = b.color as BrandColorId;
    else errors.color = ["Pick one of the listed colours"];
  }

  if (b.replyTime !== undefined) {
    if (REPLY_TIMES.includes(b.replyTime as ReplyTime)) next.replyTime = b.replyTime as ReplyTime;
    else errors.replyTime = ["Pick one of the listed reply times"];
  }

  next.title = readText(b.title, "title", MAX_TITLE, errors) ?? next.title;
  next.tagline = readText(b.tagline, "tagline", MAX_TAGLINE, errors, true) ?? next.tagline;
  next.formIntro = readText(b.formIntro, "formIntro", MAX_INTRO, errors, true) ?? next.formIntro;

  if (b.fields !== undefined) {
    if (!b.fields || typeof b.fields !== "object" || Array.isArray(b.fields)) {
      errors.fields = ["Must be an object"];
    } else {
      const sent = b.fields as Record<string, unknown>;
      for (const key of Object.keys(sent)) {
        if (!FORM_FIELD_KEYS.includes(key as FormFieldKey)) errors[`fields.${key}`] = ["Unknown field"];
      }
      for (const key of FORM_FIELD_KEYS) {
        if (sent[key] === undefined) continue;
        const entry = sent[key] as Partial<FormFieldSetting> | null;
        const isBool = (v: unknown) => v === undefined || typeof v === "boolean";
        if (!entry || typeof entry !== "object" || !isBool(entry.show) || !isBool(entry.required)) {
          errors[`fields.${key}`] = ["Must be { show, required } with true/false values"];
          continue;
        }
        next.fields[key] = {
          show: entry.show ?? next.fields[key].show,
          required: entry.required ?? next.fields[key].required,
        };
      }
    }
  }

  // A hidden field can never be required, and the visitor must always leave a way to reach them.
  for (const key of FORM_FIELD_KEYS) {
    if (!next.fields[key].show) next.fields[key].required = false;
  }
  if (!next.fields.phone.show && !next.fields.email.show) {
    errors.fields = ["Show at least the WhatsApp number or the email, so the team can reach the visitor"];
  }

  return Object.keys(errors).length > 0 ? { ok: false, errors } : { ok: true, settings: next };
}

function colorHex(id: BrandColorId): string {
  return BRAND_COLORS.find((c) => c.id === id)?.hex ?? BRAND_COLORS[0].hex;
}

/** The host the bubble is allowed on while chat is switched off: nothing can ever match it. */
export const CHAT_OFF_ALLOWED_DOMAINS = "https://chat-switched-off.invalid";

/** The site itself and its "www." twin, as Chatwoot expects them (a comma-separated list of origins). */
function allowedDomainsFor(host: string): string {
  const bare = host.replace(/^www\./, "");
  return [`https://${bare}`, `https://www.${bare}`, ...devExtraOrigins()].join(", ");
}

/**
 * Local testing only: extra origins (for example "http://admizz.localhost:3001") from
 * INBOX_CHATWOOT_DEV_ALLOWED_ORIGINS, comma-separated. Ignored in production, and only plain
 * http(s) origins (no path) are kept, so a typo cannot widen the list into something odd.
 */
function devExtraOrigins(): string[] {
  if (process.env.NODE_ENV === "production") return [];
  const raw = process.env.INBOX_CHATWOOT_DEV_ALLOWED_ORIGINS ?? "";
  return raw
    .split(",")
    .map((o) => o.trim().toLowerCase())
    .filter((o) => /^https?:\/\/[a-z0-9.-]+(:\d{1,5})?$/.test(o));
}

/**
 * The web widget attributes to send to Chatwoot. Create adds `type: "web_widget"` itself; Chatwoot rejects
 * `type` on update (HTTP 500), so it is not part of this shared shape.
 * "On" limits the bubble to the one website; "off" uses an address nothing matches, so the bubble
 * cannot load anywhere (Chatwoot has no per-inbox off switch).
 */
export function toChatwootChannel(settings: WebsiteChatSettings, enabled: boolean) {
  const labels: Record<FormFieldKey, { name: string; label: string; type: string; placeholder: string }> = {
    name: { name: "fullName", label: "Your name", type: "text", placeholder: "Your full name" },
    phone: { name: "phoneNumber", label: "WhatsApp number", type: "text", placeholder: "WhatsApp number" },
    email: { name: "emailAddress", label: "Email", type: "email", placeholder: "you@example.com" },
  };
  return {
    website_url: settings.websiteHost,
    widget_color: colorHex(settings.color),
    welcome_title: settings.title,
    welcome_tagline: settings.tagline,
    reply_time: settings.replyTime,
    pre_chat_form_enabled: true,
    pre_chat_form_options: {
      pre_chat_message: settings.formIntro,
      pre_chat_fields: FORM_FIELD_KEYS.map((key) => ({
        field_type: "standard",
        ...labels[key],
        enabled: settings.fields[key].show,
        required: settings.fields[key].required,
      })),
    },
    // Chatwoot's default flags are attachments + emoji + end-conversation; attachments stay off.
    selected_feature_flags: ["emoji_picker", "end_conversation"],
    allowed_domains: enabled ? allowedDomainsFor(settings.websiteHost) : CHAT_OFF_ALLOWED_DOMAINS,
  };
}

/** The one-line install snippet for the website. Built here from server config, not taken from Chatwoot. */
export function buildWidgetSnippet(baseUrl: string, websiteToken: string): string {
  return [
    "<script>",
    "  (function(d,t) {",
    `    var BASE_URL="${baseUrl}";`,
    "    var g=d.createElement(t),s=d.getElementsByTagName(t)[0];",
    '    g.src=BASE_URL+"/packs/js/sdk.js";',
    "    g.async=true;",
    "    s.parentNode.insertBefore(g,s);",
    "    g.onload=function(){",
    `      window.chatwootSDK.run({ websiteToken: "${websiteToken}", baseUrl: BASE_URL });`,
    "    };",
    '  })(document,"script");',
    "</script>",
  ].join("\n");
}
