import nodemailer from "nodemailer";
import { createRequestLogger } from "@/lib/logger";

interface SendSmtpEmailParams {
  smtpEmail: string;
  smtpPassword: string;
  smtpHost: string;
  smtpPort: number;
  to: string;
  subject: string;
  body: string;
}

interface SendGmailOAuth2Params {
  email: string;
  refreshToken: string;
  accessToken?: string;
  to: string;
  subject: string;
  body: string;
}

interface SmtpResult {
  success: boolean;
  error?: string;
  messageId?: string;
}

/**
 * Replace template placeholders like {{first_name}} with actual values.
 */
export function interpolateTemplate(
  template: string,
  variables: Record<string, string>
): string {
  return template.replace(/\{\{(\w+)\}\}/g, (match, key) => {
    return variables[key] ?? match;
  });
}

/**
 * Send an email using the user's own SMTP credentials.
 */
export async function sendSmtpEmail({
  smtpEmail,
  smtpPassword,
  smtpHost,
  smtpPort,
  to,
  subject,
  body,
}: SendSmtpEmailParams): Promise<SmtpResult> {
  const log = createRequestLogger({
    requestId: crypto.randomUUID(),
    method: "SMTP",
    path: "send-email",
  });

  try {
    const transporter = nodemailer.createTransport({
      host: smtpHost,
      port: smtpPort,
      secure: smtpPort === 465,
      auth: {
        user: smtpEmail,
        pass: smtpPassword,
      },
    });

    const info = await transporter.sendMail({
      from: smtpEmail,
      to,
      subject,
      html: body,
    });

    log.info({ messageId: info.messageId, to, from: smtpEmail }, "SMTP email sent");
    return { success: true, messageId: info.messageId };
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : "Unknown SMTP error";
    log.error({ err, to, from: smtpEmail }, "Failed to send SMTP email");
    return { success: false, error: errorMessage };
  }
}

/**
 * Send an email using Gmail OAuth2 (no password needed).
 */
export async function sendGmailOAuth2Email({
  email,
  refreshToken,
  accessToken,
  to,
  subject,
  body,
}: SendGmailOAuth2Params): Promise<SmtpResult> {
  const log = createRequestLogger({
    requestId: crypto.randomUUID(),
    method: "GMAIL_OAUTH2",
    path: "send-email",
  });

  const clientId = process.env.GOOGLE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET;

  if (!clientId || !clientSecret) {
    return { success: false, error: "Google OAuth not configured" };
  }

  try {
    const transporter = nodemailer.createTransport({
      service: "gmail",
      auth: {
        type: "OAuth2",
        user: email,
        clientId,
        clientSecret,
        refreshToken,
        accessToken: accessToken || undefined,
      },
    });

    const info = await transporter.sendMail({
      from: email,
      to,
      subject,
      html: body,
    });

    log.info({ messageId: info.messageId, to, from: email }, "Gmail OAuth2 email sent");
    return { success: true, messageId: info.messageId };
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : "Unknown Gmail error";
    log.error({ err, to, from: email }, "Failed to send Gmail OAuth2 email");
    return { success: false, error: errorMessage };
  }
}
