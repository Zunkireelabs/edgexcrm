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
}

const FEE_WORD: Record<string, string> = { paid: "paid", waiver: "waived", claimed: "claimed" };

/** "D Mon" — e.g. "3 Nov". */
export function shortDate(iso: string): string {
  const d = new Date(iso);
  return `${d.getDate()} ${d.toLocaleString("en-GB", { month: "short" })}`;
}

export function readyCard(input: {
  ready: boolean;
  items: readonly string[];
  consentSignedAt: string | null;
  hasActiveConsentTemplate: boolean;
  feeStatus: string | null;
}): ReadyCard {
  if (!input.ready) {
    const first = input.items.slice(0, 2).join(" · ");
    const more = input.items.length - 2;
    return {
      tone: "warn",
      value: `${input.items.length} missing`,
      sub: more > 0 ? `${first} · +${more} more` : first,
    };
  }
  const parts: string[] = [];
  if (input.hasActiveConsentTemplate && input.consentSignedAt) parts.push(`Consent signed ${shortDate(input.consentSignedAt)}`);
  const fee = input.feeStatus ? FEE_WORD[input.feeStatus] : null;
  if (fee) parts.push(`Pre-app fee ${fee}`);
  return { tone: "good", value: "Ready", sub: parts.join(" · ") };
}
