// The lead "Source" dropdowns (Edit profile -> Source): the starting lists, and how admin-added options join them.
// Pure (no network, no database). Leads keep storing the option's `value` slug in intake_source / intake_medium /
// intake_account, so the starting values below are the words the system already writes (check-in, add-lead, chat…).

export const SOURCE_KINDS = ["category", "channel", "account"] as const;
export type SourceKind = (typeof SOURCE_KINDS)[number];

export interface SourceOption {
  value: string;
  label: string;
}

/** Edit-profile field key -> which list it draws from. Campaign is deliberately not here: it stays free text. */
export const SOURCE_FIELD_KIND = { source: "category", medium: "channel", account: "account" } as const satisfies Record<string, SourceKind>;

export const DEFAULT_SOURCE_OPTIONS: Record<SourceKind, readonly SourceOption[]> = {
  // Where the lead heard about us.
  category: [
    { value: "referral", label: "Referral" },
    { value: "social_media", label: "Social media" },
    { value: "trade_show", label: "Seminar / Event" },
    { value: "google", label: "Google" },
    { value: "walk_in", label: "Walk-in" },
    { value: "phone_call", label: "Phone call" },
    { value: "email", label: "Email inquiry" },
    { value: "manual_entry", label: "Manual entry" },
    { value: "other", label: "Other" },
  ],
  // How the lead came in.
  channel: [
    { value: "check_in", label: "Check-in" },
    { value: "dashboard", label: "Dashboard" },
    { value: "chat", label: "Website chat" },
    { value: "website_form", label: "Website form" },
    { value: "integration", label: "Integration / API" },
  ],
  // The page or account (a Facebook page, an Instagram account…): the admin adds their own.
  account: [],
};

export const MAX_OPTION_LABEL = 60;

/** "Facebook Page #2" -> "facebook_page_2": the stored value for a new option. */
export function slugifyOption(label: string): string {
  return label
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "") // drop accents ("é" -> "e") so they don't become stray underscores
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, MAX_OPTION_LABEL);
}

/** Collapses stray spaces; "" when nothing is left or the label is too long to be a sensible option. */
export function cleanOptionLabel(label: unknown): string {
  if (typeof label !== "string") return "";
  const t = label.replace(/\s+/g, " ").trim();
  return t.length > MAX_OPTION_LABEL ? "" : t;
}

/** The starting list followed by the tenant's own additions, with no value or label listed twice (case-insensitive). */
export function mergeSourceOptions(kind: SourceKind, extra: readonly SourceOption[] = []): SourceOption[] {
  const out: SourceOption[] = [];
  const seenValue = new Set<string>();
  const seenLabel = new Set<string>();
  for (const o of [...DEFAULT_SOURCE_OPTIONS[kind], ...extra]) {
    const v = o.value.toLowerCase();
    const l = o.label.trim().toLowerCase();
    if (seenValue.has(v) || seenLabel.has(l)) continue;
    seenValue.add(v);
    seenLabel.add(l);
    out.push({ value: o.value, label: o.label });
  }
  return out;
}

export function isSourceKind(v: unknown): v is SourceKind {
  return typeof v === "string" && (SOURCE_KINDS as readonly string[]).includes(v);
}
