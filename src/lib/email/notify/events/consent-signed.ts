import { APP_URL } from "../../index";
import { renderEmailLayout } from "../base-layout";
import { resolveUserRecipients } from "../recipients";
import type { NotificationEmailEvent } from "../types";

/**
 * "The student signed the consent form" — emailed to the ONE user who sent the consent link (lead_consents.created_by),
 * not to all Owners/Admins. Call it only from the e-sign success path, after the signature is saved.
 * The ledger key is (event, consentId, recipient), so a retry or double call can never email twice.
 */
export interface ConsentSignedAlertPayload {
  tenantId: string;
  leadId: string;
  consentId: string;
  /** User who sent the link. Null (old rows) = nobody to tell, nothing is sent. */
  senderUserId: string | null;
  /** Name the student typed when signing. */
  signerName?: string | null;
  signedAt?: string | null;
}

interface ConsentSignedContext {
  leadName: string;
}

const EDGEX_BLUE = "#0A6CFF";

function formatSigned(iso: string | null | undefined, timeZone: string): string {
  const d = iso ? new Date(iso) : new Date();
  const date = Number.isNaN(d.getTime()) ? new Date() : d;
  const fmt = (tz: string) =>
    new Intl.DateTimeFormat("en-GB", {
      day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit", hour12: true, timeZone: tz,
    }).format(date);
  try {
    return fmt(timeZone || "UTC");
  } catch {
    return fmt("UTC");
  }
}

export const consentSignedEvent: NotificationEmailEvent<ConsentSignedAlertPayload, ConsentSignedContext> = {
  id: "consent_signed",
  roles: [],
  tenantId: (p) => p.tenantId,
  entityId: (p) => p.consentId,

  async recipients(p, db) {
    return p.senderUserId ? resolveUserRecipients(db, p.tenantId, [p.senderUserId]) : [];
  },

  async prepare(p, db) {
    if (!p.senderUserId) return null;
    const { data } = await db
      .from("leads")
      .select("first_name, last_name, email")
      .eq("id", p.leadId)
      .eq("tenant_id", p.tenantId)
      .maybeSingle();
    if (!data) return null;
    const l = data as { first_name: string | null; last_name: string | null; email: string | null };
    const name = `${l.first_name ?? ""} ${l.last_name ?? ""}`.trim() || p.signerName?.trim() || l.email?.trim() || "The student";
    return { leadName: name };
  },

  build({ payload, context, tenant }) {
    const { html, text } = renderEmailLayout({
      title: `${context.leadName} signed the consent form`,
      preheader: `${context.leadName} signed the consent form`,
      tenantName: tenant.name,
      logo: { url: `${APP_URL}/email/edgex-logo.png`, alt: "EdgeX" },
      primaryColor: EDGEX_BLUE,
      eyebrow: "Consent signed",
      heading: context.leadName,
      lede: [{ text: context.leadName, bold: true }, { text: " has signed the consent form you sent." }],
      rows: [
        { label: "Signed by", value: payload.signerName?.trim() || null },
        { label: "Signed", value: formatSigned(payload.signedAt, tenant.timezone) },
      ],
      cta: { label: "Open lead in EdgeX", url: `${APP_URL}/leads/${payload.leadId}` },
      footer: `You're receiving this because you sent this consent form from ${tenant.name}.`,
    });
    return { subject: `${context.leadName} signed the consent form — ${tenant.name}`, html, text };
  },
};
