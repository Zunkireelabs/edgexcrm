import { createServiceClient } from "@/lib/supabase/server";
import { EMAIL_FROM, PLATFORM_EMAIL_ADDRESS } from "./index";

export type ResolvedSender = {
  from: string;
  replyTo?: string;
  orgName: string;
  mailingAddress?: string | null;
};

// Strip anything that could break the RFC 5322 header (CR/LF/angle brackets).
function sanitizeName(name: string): string {
  return name.replace(/[\r\n<>]/g, "").trim().slice(0, 120);
}
function isValidEmail(addr: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(addr);
}

export type VerifiedCompanySender = {
  /** `Name <address>` — the RFC 5322 From header value. */
  from: string;
  /** The bare verified address, e.g. hello@mail.admizz.com. */
  address: string;
  /** Display name (already sanitized). */
  name: string;
  /** The tenant's configured Reply-To (the team mailbox), when valid. */
  replyTo: string | null;
};

/**
 * The tenant's own VERIFIED company sender, or null. Unlike resolveTenantSender
 * this never falls back to the shared platform address: it answers "may a person
 * pick the company address as their From?", and the answer is yes only for a
 * custom address on a verified domain. Never throws (null on any error), so a
 * settings hiccup just hides the option instead of breaking the compose dialog.
 */
export async function resolveVerifiedCompanySender(tenantId: string): Promise<VerifiedCompanySender | null> {
  try {
    const supabase = await createServiceClient();
    const { data } = await supabase
      .from("tenant_email_settings")
      .select("from_name, from_address, reply_to, domain_verified")
      .eq("tenant_id", tenantId)
      .maybeSingle();

    if (!data?.domain_verified || !data.from_address || !isValidEmail(data.from_address)) return null;

    const name = sanitizeName(data.from_name || "EdgeX") || "EdgeX";
    const replyTo = data.reply_to && isValidEmail(data.reply_to) ? data.reply_to : null;
    return { from: `${name} <${data.from_address}>`, address: data.from_address, name, replyTo };
  } catch {
    return null;
  }
}

/**
 * Resolve the outbound sender identity for a tenant's AUTOMATION emails.
 * Falls back to the global EdgeX sender on any miss/error — never throws.
 * @param nameOverride optional per-rule display-name override (email-forward rules)
 */
export async function resolveTenantSender(
  tenantId: string,
  opts?: { nameOverride?: string }
): Promise<ResolvedSender> {
  try {
    const supabase = await createServiceClient();
    const { data } = await supabase
      .from("tenant_email_settings")
      .select("from_name, from_address, reply_to, domain_verified, mailing_address")
      .eq("tenant_id", tenantId)
      .maybeSingle();

    const rawName = opts?.nameOverride || data?.from_name || "EdgeX";
    const name = sanitizeName(rawName) || "EdgeX";

    const customAddr =
      data?.from_address && isValidEmail(data.from_address) ? data.from_address : null;

    // Custom address ONLY when the domain is verified. Otherwise brand the name
    // on our verified domain and route replies to the tenant address.
    const address = data?.domain_verified && customAddr ? customAddr : PLATFORM_EMAIL_ADDRESS;

    const replyToRaw = data?.reply_to || customAddr || null;
    const replyTo = replyToRaw && isValidEmail(replyToRaw) ? replyToRaw : undefined;

    return { from: `${name} <${address}>`, replyTo, orgName: name, mailingAddress: data?.mailing_address ?? null };
  } catch {
    return { from: EMAIL_FROM, orgName: "EdgeX" };
  }
}
