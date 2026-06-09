import { createServiceClient } from "@/lib/supabase/server";
import { getResendClient, EMAIL_FROM } from "./index";
import { renderTemplate } from "./render-template";
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
  const ar = formConfig.autoresponder;
  if (!ar?.enabled) return;
  if (!lead.email) return;

  // Fire-mode gate
  if (ar.fire_mode === "first" && opts.isResubmission) return;

  const resend = getResendClient();
  if (!resend) return;

  const renderCtx = { lead, tenant: opts.tenant };
  const subject = renderTemplate(ar.subject, renderCtx, { escape: false });
  const bodyHtml = renderTemplate(ar.body_html, renderCtx, { escape: true });

  let status: "sent" | "failed" = "sent";
  let errorMsg: string | null = null;
  let providerMessageId: string | null = null;

  try {
    const { data, error } = await resend.emails.send({
      from: EMAIL_FROM,
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
    } else {
      providerMessageId = data?.id ?? null;
    }
  } catch (err) {
    status = "failed";
    errorMsg = err instanceof Error ? err.message : String(err);
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
  } catch { /* non-fatal */ }
}
