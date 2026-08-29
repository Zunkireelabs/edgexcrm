import { getResendClient, APP_URL } from "./index";
import { resolveTenantSender } from "./sender";
import { getConsentEmailTemplate, getConsentEmailSubject } from "./templates/consent";
import { createRequestLogger } from "@/lib/logger";

interface SendConsentEmailParams {
  to: string;
  studentName: string;
  tenantName: string;
  tenantId: string;
  token: string;
  primaryColor?: string;
  expiryDays: number;
}

interface SendEmailResult {
  success: boolean;
  error?: string;
  messageId?: string;
}

export async function sendConsentEmail({
  to,
  studentName,
  tenantName,
  tenantId,
  token,
  primaryColor,
  expiryDays,
}: SendConsentEmailParams): Promise<SendEmailResult> {
  const log = createRequestLogger({
    requestId: crypto.randomUUID(),
    method: "EMAIL",
    path: "send-consent",
  });

  const resend = getResendClient();
  if (!resend) {
    log.warn({ to, tenantName }, "Email disabled - RESEND_API_KEY not configured");
    return { success: false, error: "Email not configured" };
  }

  const consentLink = `${APP_URL}/consent/${token}`;
  const sender = await resolveTenantSender(tenantId);

  try {
    const { data, error } = await resend.emails.send({
      from: sender.from,
      ...(sender.replyTo ? { replyTo: sender.replyTo } : {}),
      to,
      subject: getConsentEmailSubject(tenantName),
      html: getConsentEmailTemplate({
        tenantName,
        studentName,
        consentLink,
        expiryDays,
        primaryColor,
      }),
    });

    if (error) {
      log.error({ err: error, to, tenantName }, "Failed to send consent email");
      return { success: false, error: error.message };
    }

    log.info(
      { messageId: data?.id, to, tenantName, from: sender.from, replyTo: sender.replyTo },
      "Consent email sent"
    );
    return { success: true, messageId: data?.id };
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : "Unknown error";
    log.error({ err, to, tenantName }, "Exception sending consent email");
    return { success: false, error: errorMessage };
  }
}
