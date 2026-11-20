// Website chat settings: what an admin can change, the rules for each value, and how they map to
// Chatwoot's web widget. Pure functions only (no network, no database), so every rule is unit-tested.
//
// Decisions (v1): the bubble colour is one of a fixed set of colours, or a custom colour that is dark
// enough for white text to be readable (see MIN_COLOR_CONTRAST), file uploads are always
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

/** Chatwoot paints white text on the chosen colour, so it must be dark enough to read (WCAG AA, normal text). */
export const MIN_COLOR_CONTRAST = 4.5;

/** "#001353", "001353" or "#013" -> "#001353" (upper case), or null when it is not a hex colour. */
export function normalizeHexColor(input: string): string | null {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(input.trim());
  if (!m) return null;
  const h = m[1].length === 3 ? m[1].split("").map((c) => c + c).join("") : m[1];
  return `#${h.toUpperCase()}`;
}

/** WCAG contrast ratio of white text on this "#RRGGBB" colour: 1 (invisible) to 21 (black). */
export function contrastWithWhite(hex: string): number {
  const [r, g, b] = [1, 3, 5]
    .map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 1.05 / (0.2126 * r + 0.7152 * g + 0.0722 * b + 0.05);
}

export const REPLY_TIMES = ["in_a_few_minutes", "in_a_few_hours", "in_a_day"] as const;
export type ReplyTime = (typeof REPLY_TIMES)[number];

export const FORM_FIELD_KEYS = ["name", "phone", "email"] as const;
export type FormFieldKey = (typeof FORM_FIELD_KEYS)[number];

export interface FormFieldSetting {
  show: boolean;
  required: boolean;
}

/** Time zones the card offers (IANA names; Chatwoot accepts these). A short list keeps the choice obvious. */
export const TIMEZONES = [
  { id: "UTC", label: "UTC" },
  { id: "Asia/Kathmandu", label: "Nepal (Kathmandu)" },
  { id: "Asia/Kolkata", label: "India (Kolkata)" },
  { id: "Asia/Dhaka", label: "Bangladesh (Dhaka)" },
  { id: "Asia/Dubai", label: "UAE (Dubai)" },
  { id: "Asia/Singapore", label: "Singapore" },
  { id: "Australia/Sydney", label: "Australia (Sydney)" },
  { id: "Europe/London", label: "UK (London)" },
  { id: "America/New_York", label: "US East (New York)" },
  { id: "America/Chicago", label: "US Central (Chicago)" },
  { id: "America/Los_Angeles", label: "US West (Los Angeles)" },
] as const;

/** Older spellings some browsers still report (Chrome on Mac says "Asia/Katmandu" for Nepal) -> the name we list. */
const TIMEZONE_ALIASES: Record<string, string> = {
  "Asia/Katmandu": "Asia/Kathmandu",
  "Asia/Calcutta": "Asia/Kolkata",
  "Asia/Dacca": "Asia/Dhaka",
  "Etc/UTC": "UTC",
  "Etc/GMT": "UTC",
  "GMT": "UTC",
};

/** The listed time zone id for what a browser reported, or null when it is not one we offer. */
export function listedTimezone(reported: string | null | undefined): string | null {
  if (!reported) return null;
  const name = TIMEZONE_ALIASES[reported] ?? reported;
  return TIMEZONES.some((t) => t.id === name) ? name : null;
}

/**
 * When the team is "in". Off by default: with it off the chat always shows as online (the team user is kept
 * online in Chatwoot), so an admin should turn it on and set the real hours. Days are 0 = Sunday ... 6 = Saturday.
 */
export interface OfficeHoursSetting {
  enabled: boolean;
  timezone: string;
  days: number[];
  /** "HH:MM", 24 hours. */
  open: string;
  close: string;
}

export const DEFAULT_OFFICE_HOURS: OfficeHoursSetting = {
  enabled: false,
  timezone: "UTC",
  days: [1, 2, 3, 4, 5],
  open: "09:00",
  close: "17:00",
};

const TIME_PATTERN = /^([01]\d|2[0-3]):([0-5]\d)$/;

export interface WebsiteChatSettings {
  /** The one site allowed to show the bubble, stored as a bare host, e.g. "admizzeducation.com". */
  websiteHost: string;
  /** A BRAND_COLORS id (for example "teal") or a custom "#RRGGBB" that passes MIN_COLOR_CONTRAST. */
  color: string;
  title: string;
  tagline: string;
  replyTime: ReplyTime;
  formIntro: string;
  fields: Record<FormFieldKey, FormFieldSetting>;
  officeHours: OfficeHoursSetting;
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
  officeHours: DEFAULT_OFFICE_HOURS,
};

/** Settings saved before a field existed come back without it; fill the gaps with the defaults. */
export function withSettingDefaults(stored: Partial<WebsiteChatSettings> & { websiteHost: string }): WebsiteChatSettings {
  return {
    ...DEFAULT_WEBSITE_CHAT_SETTINGS,
    ...stored,
    fields: { ...DEFAULT_WEBSITE_CHAT_SETTINGS.fields, ...stored.fields },
    officeHours: { ...DEFAULT_OFFICE_HOURS, ...stored.officeHours },
  };
}

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
  const next: WebsiteChatSettings = {
    ...current,
    fields: { ...current.fields },
    officeHours: { ...DEFAULT_OFFICE_HOURS, ...current.officeHours, days: [...(current.officeHours?.days ?? DEFAULT_OFFICE_HOURS.days)] },
  };

  if (b.websiteHost !== undefined) {
    const host = typeof b.websiteHost === "string" ? normalizeWebsiteHost(b.websiteHost) : null;
    if (host) next.websiteHost = host;
    else errors.websiteHost = ["Enter your website address, for example example.com"];
  }

  if (b.color !== undefined) {
    if (typeof b.color === "string" && BRAND_COLORS.some((c) => c.id === b.color)) {
      next.color = b.color;
    } else {
      const hex = typeof b.color === "string" ? normalizeHexColor(b.color) : null;
      if (!hex) {
        errors.color = ["Pick a listed colour, or enter one like #001353"];
      } else if (contrastWithWhite(hex) < MIN_COLOR_CONTRAST) {
        errors.color = [
          `That colour is too light for white text (${contrastWithWhite(hex).toFixed(1)}:1, it needs at least ${MIN_COLOR_CONTRAST}:1). Pick a darker one.`,
        ];
      } else {
        next.color = hex;
      }
    }
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

  if (b.officeHours !== undefined) {
    const hours = readOfficeHours(b.officeHours, next.officeHours);
    if (typeof hours === "string") errors.officeHours = [hours];
    else next.officeHours = hours;
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

/** Applies what was sent on top of the current hours. Returns the new hours, or a message saying what is wrong. */
function readOfficeHours(input: unknown, current: OfficeHoursSetting): OfficeHoursSetting | string {
  if (!input || typeof input !== "object" || Array.isArray(input)) return "Office hours must be an object";
  const b = input as Record<string, unknown>;
  const next: OfficeHoursSetting = { ...current, days: [...current.days] };

  if (b.enabled !== undefined) {
    if (typeof b.enabled !== "boolean") return "Office hours on/off must be true or false";
    next.enabled = b.enabled;
  }
  if (b.timezone !== undefined) {
    if (typeof b.timezone !== "string" || !TIMEZONES.some((t) => t.id === b.timezone)) return "Pick one of the listed time zones";
    next.timezone = b.timezone;
  }
  if (b.days !== undefined) {
    const days = b.days;
    if (!Array.isArray(days) || !days.every((d) => Number.isInteger(d) && d >= 0 && d <= 6)) return "Days must be numbers from 0 (Sunday) to 6 (Saturday)";
    next.days = [...new Set(days as number[])].sort((a, c) => a - c);
  }
  for (const key of ["open", "close"] as const) {
    if (b[key] === undefined) continue;
    if (typeof b[key] !== "string" || !TIME_PATTERN.test(b[key] as string)) return `The ${key} time must look like 09:00`;
    next[key] = b[key] as string;
  }

  if (next.enabled) {
    if (next.days.length === 0) return "Pick at least one day the team is available";
    if (next.close <= next.open) return "The closing time must be after the opening time";
  }
  return next;
}

/** The "#RRGGBB" Chatwoot gets. A stored custom colour that is no longer valid falls back to the first listed colour. */
function colorHex(color: string): string {
  const preset = BRAND_COLORS.find((c) => c.id === color);
  if (preset) return preset.hex;
  const hex = normalizeHexColor(color);
  return hex && contrastWithWhite(hex) >= MIN_COLOR_CONTRAST ? hex : BRAND_COLORS[0].hex;
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

/**
 * The inbox-level fields Chatwoot takes next to `channel`. `name` is what the chat header shows on the form
 * screen, so it follows the title. Working hours are sent even while off; Chatwoot ignores them until enabled.
 */
export function toChatwootInbox(settings: WebsiteChatSettings) {
  const hours = { ...DEFAULT_OFFICE_HOURS, ...settings.officeHours };
  const [openHour, openMinutes] = hours.open.split(":").map(Number);
  const [closeHour, closeMinutes] = hours.close.split(":").map(Number);
  return {
    name: settings.title,
    working_hours_enabled: hours.enabled,
    timezone: hours.timezone,
    working_hours: [0, 1, 2, 3, 4, 5, 6].map((day) =>
      hours.days.includes(day)
        ? { day_of_week: day, closed_all_day: false, open_all_day: false, open_hour: openHour, open_minutes: openMinutes, close_hour: closeHour, close_minutes: closeMinutes }
        : { day_of_week: day, closed_all_day: true, open_all_day: false }
    ),
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
