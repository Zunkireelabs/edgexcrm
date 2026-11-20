/**
 * Display items for the "Ready to apply" card. The server's gate (`checkApplicationsReadiness`) returns
 * labels like "Processing fee", "Basic info (Passport Number, Date Of Birth)", "Consent signed"; the card
 * shows them one by one, in plain words.
 */
export function flattenReadiness(missing: readonly string[]): string[] {
  const items: string[] = [];
  for (const raw of missing) {
    const label = raw.trim();
    if (label === "Processing fee") {
      items.push("Pre-app fee");
    } else if (label === "Consent signed") {
      items.push("Signed consent");
    } else if (label.startsWith("Basic info")) {
      const m = /^Basic info\s*\((.*)\)\s*$/.exec(label);
      const fields = (m?.[1] ?? "").split(",").map((f) => f.trim()).filter(Boolean);
      if (fields.length === 0) items.push("Basic info");
      for (const f of fields) items.push(sentenceCase(f));
    } else if (label) {
      items.push(label);
    }
  }
  return items;
}

export function sentenceCase(text: string): string {
  const t = text.trim().toLowerCase();
  return t ? t.charAt(0).toUpperCase() + t.slice(1) : t;
}

export interface ReadyCard {
  tone: "warn" | "good";
  value: string;
  sub: string;
  /** Full, untruncated list (tooltip) when items are missing. */
  subTitle?: string;
}

const FEE_WORD: Record<string, string> = { paid: "paid", waiver: "waived", claimed: "claimed" };

/** "dm" = "3 Nov" (the record preview); "md" = "Nov 3" (the lead detail page, month first like its mockup). */
export type DateFmt = "dm" | "md";

export function shortDate(iso: string, fmt: DateFmt = "dm"): string {
  const d = new Date(iso);
  const mon = d.toLocaleString("en-GB", { month: "short" });
  return fmt === "md" ? `${mon} ${d.getDate()}` : `${d.getDate()} ${mon}`;
}

/** Max characters for the missing-items sub-line, so "+N more" is never ellipsized by the card. */
export const READY_SUB_BUDGET = 30;

/** Largest prefix of items whose whole string (incl. " · +N more") fits the budget; always at least 1 item. */
export function missingSub(items: readonly string[], budget = READY_SUB_BUDGET): string {
  const n = items.length;
  for (let k = n; k >= 1; k--) {
    const text = items.slice(0, k).join(" · ") + (k < n ? ` · +${n - k} more` : "");
    if (text.length <= budget) return text;
  }
  return n === 0 ? "" : items.length === 1 ? items[0] : `${items[0]} · +${n - 1} more`;
}

export function readyCard(input: {
  ready: boolean;
  items: readonly string[];
  consentSignedAt: string | null;
  hasActiveConsentTemplate: boolean;
  feeStatus: string | null;
  dateFormat?: DateFmt;
}): ReadyCard {
  if (!input.ready) {
    return { tone: "warn", value: `${input.items.length} missing`, sub: missingSub(input.items), subTitle: input.items.join(" · ") };
  }
  const parts: string[] = [];
  if (input.hasActiveConsentTemplate && input.consentSignedAt) parts.push(`Consent signed ${shortDate(input.consentSignedAt, input.dateFormat)}`);
  const fee = input.feeStatus ? FEE_WORD[input.feeStatus] : null;
  if (fee) parts.push(`Pre-app fee ${fee}`);
  return { tone: "good", value: "Ready", sub: parts.join(" · ") };
}
