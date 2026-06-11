import { createServiceClient } from "@/lib/supabase/server";
import { getResendClient } from "./index";
import { resolveTenantSender } from "./sender";
import { renderTemplate } from "./render-template";
import { createRequestLogger } from "@/lib/logger";
import type { FormConfig, Lead } from "@/types/database";

/**
 * Send a per-form confirmation email to the submitter.
 * Fully fire-and-forget — never rejects into the request path.
 */
export async function processFormAutoresponder(
  formConfig: FormConfig,
  lead: Lead,
  opts: { isResubmission: boolean; tenant?: { name?: string } }
): Promise<void> {
  const log = createRequestLogger({
    requestId: crypto.randomUUID(),
    method: "FORM_AUTORESPONDER",
    path: "process",
  });

  const ar = formConfig.autoresponder;
  if (!ar?.enabled) {
    log.info({ formId: formConfig.id, leadId: lead.id }, "Autoresponder disabled, skipping");
    return;
  }
  if (!lead.email) {
    log.info({ formId: formConfig.id, leadId: lead.id }, "Lead has no email, skipping autoresponder");
    return;
  }

  // Fire-mode gate
  if (ar.fire_mode === "first" && opts.isResubmission) {
    log.info(
      { formId: formConfig.id, leadId: lead.id },
      "fire_mode=first on a resubmission, skipping autoresponder"
    );
    return;
  }

  const resend = getResendClient();
  if (!resend) {
    log.warn({ formId: formConfig.id, leadId: lead.id }, "Resend not configured, skipping autoresponder");
    return;
  }

  log.info(
    { formId: formConfig.id, leadId: lead.id, to: lead.email, fireMode: ar.fire_mode, isResubmission: opts.isResubmission },
    "Sending form autoresponder"
  );

  const renderCtx = { lead, tenant: opts.tenant };
  const subject = renderTemplate(ar.subject, renderCtx, { escape: false });
  // Field values are escaped inside renderTemplate; we then convert the admin's
  // plain-text line breaks into <br> so they survive in the HTML email body
  // (raw \n collapses to whitespace in HTML). The injected <br> is our own markup.
  const bodyHtml = renderTemplate(ar.body_html, renderCtx, { escape: true }).replace(
    /\r\n|\r|\n/g,
    "<br>"
  );

  let status: "sent" | "failed" = "sent";
  let errorMsg: string | null = null;
  let providerMessageId: string | null = null;

  const sender = await resolveTenantSender(lead.tenant_id);

  try {
    const { data, error } = await resend.emails.send({
      from: sender.from,
      ...(sender.replyTo ? { replyTo: sender.replyTo } : {}),
      to: lead.email,
      subject,
      html: bodyHtml,
    });

    if (error) {
      status = "failed";
      errorMsg =
        typeof error === "object" && error !== null && "message" in error
          ? String((error as { message: unknown }).message)
          : String(error);
      log.error({ formId: formConfig.id, leadId: lead.id, err: error }, "Form autoresponder send failed");
    } else {
      providerMessageId = data?.id ?? null;
      log.info(
        { formId: formConfig.id, leadId: lead.id, messageId: providerMessageId },
        "Form autoresponder sent"
      );
    }
  } catch (err) {
    status = "failed";
    errorMsg = err instanceof Error ? err.message : String(err);
    log.error({ formId: formConfig.id, leadId: lead.id, err }, "Form autoresponder send exception");
  }

  // Best-effort log row — must never throw out of this function
  try {
    const supabase = await createServiceClient();
    await supabase.from("automation_email_log").insert({
      tenant_id: lead.tenant_id,
      lead_id: lead.id,
      form_config_id: formConfig.id,
      source: "form_autoresponder",
      to_email: lead.email,
      subject,
      status,
      error: errorMsg,
      provider_message_id: providerMessageId,
    });
  } catch (err) {
    log.warn({ formId: formConfig.id, leadId: lead.id, err }, "Failed to write automation_email_log row");
  }
}
