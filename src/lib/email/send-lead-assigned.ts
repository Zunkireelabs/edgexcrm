import { getResendClient, EMAIL_FROM, APP_URL } from "./index";
import {
  getLeadAssignedEmailTemplate,
  getLeadAssignedEmailSubject,
  getBulkAssignedEmailTemplate,
  getBulkAssignedEmailSubject,
} from "./templates/lead-assigned";
import { createRequestLogger } from "@/lib/logger";

interface SendLeadAssignedEmailParams {
  to: string;
  assignerEmail: string;
  tenantName: string;
  leadId: string;
  leadName: string;
  leadEmail?: string;
  primaryColor?: string;
}

interface SendBulkAssignedEmailParams {
  to: string;
  assignerEmail: string;
  tenantName: string;
  leadCount: number;
  primaryColor?: string;
}

interface SendEmailResult {
  success: boolean;
  error?: string;
  messageId?: string;
}

export async function sendLeadAssignedEmail({
  to,
  assignerEmail,
  tenantName,
  leadId,
  leadName,
  leadEmail,
  primaryColor,
}: SendLeadAssignedEmailParams): Promise<SendEmailResult> {
  const log = createRequestLogger({
    requestId: crypto.randomUUID(),
    method: "EMAIL",
    path: "send-lead-assigned",
  });

  const resend = getResendClient();
  if (!resend) {
    log.warn({ to, leadId, tenantName }, "Email disabled - RESEND_API_KEY not configured");
    return { success: false, error: "Email not configured" };
  }

  const leadLink = `${APP_URL}/leads/${leadId}`;

  try {
    const { data, error } = await resend.emails.send({
      from: EMAIL_FROM,
      to,
      subject: getLeadAssignedEmailSubject(leadName),
      html: getLeadAssignedEmailTemplate({
        tenantName,
        assignerEmail,
        leadName,
        leadEmail,
        leadLink,
        primaryColor,
      }),
    });

    if (error) {
      log.error(
        { err: error, to, leadId, tenantName },
        "Failed to send lead assigned email"
      );
      return { success: false, error: error.message };
    }

    log.info(
      { messageId: data?.id, to, leadId, tenantName },
      "Lead assigned email sent"
    );
    return { success: true, messageId: data?.id };
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : "Unknown error";
    log.error({ err, to, leadId, tenantName }, "Exception sending lead email");
    return { success: false, error: errorMessage };
  }
}

export async function sendBulkAssignedEmail({
  to,
  assignerEmail,
  tenantName,
  leadCount,
  primaryColor,
}: SendBulkAssignedEmailParams): Promise<SendEmailResult> {
  const log = createRequestLogger({
    requestId: crypto.randomUUID(),
    method: "EMAIL",
    path: "send-bulk-assigned",
  });

  const resend = getResendClient();
  if (!resend) {
    log.warn({ to, leadCount, tenantName }, "Email disabled - RESEND_API_KEY not configured");
    return { success: false, error: "Email not configured" };
  }

  const leadsLink = `${APP_URL}/leads`;

  try {
    const { data, error } = await resend.emails.send({
      from: EMAIL_FROM,
      to,
      subject: getBulkAssignedEmailSubject(leadCount),
      html: getBulkAssignedEmailTemplate({
        tenantName,
        assignerEmail,
        leadCount,
        leadsLink,
        primaryColor,
      }),
    });

    if (error) {
      log.error(
        { err: error, to, leadCount, tenantName },
        "Failed to send bulk assigned email"
      );
      return { success: false, error: error.message };
    }

    log.info(
      { messageId: data?.id, to, leadCount, tenantName },
      "Bulk assigned email sent"
    );
    return { success: true, messageId: data?.id };
  } catch (err) {
    const errorMessage = err instanceof Error ? err.message : "Unknown error";
    log.error(
      { err, to, leadCount, tenantName },
      "Exception sending bulk email"
    );
    return { success: false, error: errorMessage };
  }
}
