import { createServiceClient } from "@/lib/supabase/server";
import { createNotification, NotificationTypes } from "@/lib/notifications";
import { dispatchNotificationEmail, consentSignedEvent } from "@/lib/email/notify";
import { logger } from "@/lib/logger";

export interface ConsentSignedNotifyArgs {
  tenantId: string;
  leadId: string;
  consentId: string;
  /** lead_consents.created_by — the person who sent the link. */
  senderUserId: string | null;
  signerName: string;
  signedAt: string;
}

/**
 * Tell the person who sent the consent link that the student signed: a bell notification + an email.
 * Best-effort and NEVER throws — the signature is already saved, so a notification problem must not reach the student.
 * No sender recorded (old rows) = nothing to do.
 */
export async function notifyConsentSigned(a: ConsentSignedNotifyArgs): Promise<void> {
  if (!a.senderUserId) return;
  try {
    const supabase = await createServiceClient();
    const { data } = await supabase
      .from("leads")
      .select("first_name, last_name")
      .eq("id", a.leadId)
      .eq("tenant_id", a.tenantId)
      .maybeSingle();
    const l = data as { first_name: string | null; last_name: string | null } | null;
    const name = `${l?.first_name ?? ""} ${l?.last_name ?? ""}`.trim() || a.signerName;

    await createNotification({
      tenantId: a.tenantId,
      userId: a.senderUserId,
      type: NotificationTypes.CONSENT_SIGNED,
      title: "Consent signed",
      message: `${name} signed the consent form`,
      link: `/leads/${a.leadId}`,
    });
  } catch (err) {
    logger.error({ err, consentId: a.consentId }, "consent signed: bell notification failed");
  }

  void dispatchNotificationEmail(consentSignedEvent, {
    tenantId: a.tenantId,
    leadId: a.leadId,
    consentId: a.consentId,
    senderUserId: a.senderUserId,
    signerName: a.signerName,
    signedAt: a.signedAt,
  }).catch(() => {});
}
