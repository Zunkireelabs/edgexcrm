import { createServiceClient } from "@/lib/supabase/server";
import type { VerifiedCompanySender } from "./sender";
import type { BrandedBrand } from "./template/branded-message";

// The tenant's NO-REPLY sender (e.g. no-reply@mail.admizz.com): a second address on the SAME verified domain as the company
// address, whose one-off emails are wrapped in the branded layout (template/branded-message.ts). One place decides whether it
// may be offered and what it looks like, and both the New email pop-up (through the company-sender endpoint) and the send path
// (company-send.ts) ask it, so what the person previews is what is sent.

export type NoReplySender = {
  /** Same shape as the company sender, so the send path treats both alike. `replyTo` is the team mailbox. */
  sender: VerifiedCompanySender;
  /** Everything the layout needs. */
  brand: BrandedBrand;
};

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const isEmail = (v: unknown): v is string => typeof v === "string" && EMAIL.test(v);
const domainOf = (addr: string) => addr.slice(addr.lastIndexOf("@") + 1).toLowerCase();
// Strip anything that could break the RFC 5322 From header (CR/LF/angle brackets), as the company sender does.
const cleanName = (name: string) => name.replace(/[\r\n<>]/g, "").trim().slice(0, 120);

interface SettingsRow {
  from_name: string | null;
  from_address: string | null;
  reply_to: string | null;
  domain_verified: boolean | null;
  no_reply_address: string | null;
  template_color: string | null;
  template_accent: string | null;
}
interface TenantRow {
  name: string | null;
  logo_url: string | null;
  primary_color: string | null;
}

/**
 * The tenant's no-reply sender and look, or null. It is offered only when the company address is verified AND the no-reply
 * address is a valid, different address on that same domain (so nobody can pick a sender on a domain we have not verified).
 * Never throws: a settings hiccup just hides the option instead of breaking the New email pop-up.
 */
export async function resolveNoReplySender(tenantId: string): Promise<NoReplySender | null> {
  try {
    const supabase = await createServiceClient();
    const [settingsRes, tenantRes] = await Promise.all([
      supabase
        .from("tenant_email_settings")
        .select("from_name, from_address, reply_to, domain_verified, no_reply_address, template_color, template_accent")
        .eq("tenant_id", tenantId)
        .maybeSingle(),
      supabase.from("tenants").select("name, logo_url, primary_color").eq("id", tenantId).maybeSingle(),
    ]);
    const s = settingsRes.data as unknown as SettingsRow | null;
    const t = tenantRes.data as unknown as TenantRow | null;

    if (!s?.domain_verified || !isEmail(s.from_address) || !isEmail(s.no_reply_address)) return null;
    if (domainOf(s.from_address) !== domainOf(s.no_reply_address)) return null;
    if (s.from_address.toLowerCase() === s.no_reply_address.toLowerCase()) return null;

    const name = cleanName(s.from_name || t?.name || "EdgeX") || "EdgeX";
    const replyTo = isEmail(s.reply_to) ? s.reply_to : null;
    return {
      sender: { from: `${name} <${s.no_reply_address}>`, address: s.no_reply_address, name, replyTo },
      brand: {
        name,
        logoUrl: t?.logo_url ?? null,
        color: s.template_color ?? t?.primary_color ?? null,
        accent: s.template_accent ?? null,
        helpEmail: replyTo,
      },
    };
  } catch {
    return null;
  }
}
