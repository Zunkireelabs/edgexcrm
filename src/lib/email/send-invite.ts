import { resend, EMAIL_FROM, APP_URL } from "./index";
import {
  getInviteEmailTemplate,
  getInviteEmailSubject,
} from "./templates/invite";
import { createRequestLogger } from "@/lib/logger";

// Debug: log configuration on module load
console.log("[Email] EMAIL_FROM:", EMAIL_FROM);
console.log("[Email] APP_URL:", APP_URL);
console.log("[Email] RESEND_API_KEY exists:", !!process.env.RESEND_API_KEY);

interface SendInviteEmailParams {
  to: string;
  inviterEmail: string;
  tenantName: string;
  role: string;
  token: string;
  primaryColor?: string;
}

interface SendEmailResult {
  success: boolean;
  error?: string;
  messageId?: string;
}

export async function sendInviteEmail({
  to,
  inviterEmail,
  tenantName,
  role,
  token,
  primaryColor,
}: SendInviteEmailParams): Promise<SendEmailResult> {
  const log = createRequestLogger({
    requestId: crypto.randomUUID(),
    method: "EMAIL",
    path: "send-invite",
  });

  const inviteLink = `${APP_URL}/register?token=${token}`;

  try {
    const { data, error } = await resend.emails.send({
      from: EMAIL_FROM,
      to,
      subject: getInviteEmailSubject(tenantName),
      html: getInviteEmailTemplate({
        tenantName,
        inviterEmail,
        role,
        inviteLink,
        primaryColor,
      }),
    });

    if (error) {
      log.error({ err: error, to, tenantName }, "Failed to send invite email");
      return { success: false, error: error.message };
    }

    log.info({ messageId: data?.id, to, tenantName }, "Invite email sent");
    return { success: true, messageId: data?.id };
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : "Unknown error";
    log.error({ err, to, tenantName }, "Exception sending invite email");
    return { success: false, error: errorMessage };
  }
}
