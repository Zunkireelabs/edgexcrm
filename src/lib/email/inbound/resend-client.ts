// Thin wrapper over resend.emails.receiving.* — built on the existing
// getResendClient() (src/lib/email/index.ts). Resend already ships
// already-parsed html/text/headers via receiving.get(); no mailparser needed
// (brief §3 finding 1).

import { logger } from "@/lib/logger";
import { getResendClient } from "@/lib/email";
import type { GetReceivingEmailResponseSuccess } from "resend";

/**
 * Fetches the full parsed body (html/text/headers/attachments metadata) for
 * one Resend-inbound email. Throws on any failure — the caller
 * (process-inbound.ts) runs this inside its per-event try/catch, so a throw
 * here is exactly what drives the events-table attempts/retry mechanism
 * (never call this from the webhook route itself — brief §7 rule 6).
 */
export async function getReceivingEmail(emailId: string): Promise<GetReceivingEmailResponseSuccess> {
  const resend = getResendClient();
  if (!resend) {
    throw new Error("RESEND_API_KEY not configured — cannot fetch inbound email body");
  }

  const { data, error } = await resend.emails.receiving.get(emailId);
  if (error || !data) {
    throw new Error(`resend.emails.receiving.get(${emailId}) failed: ${error?.message ?? "no data returned"}`);
  }

  return data;
}

/**
 * Best-effort passthrough forward to the rep's connected Gmail inbox, so they
 * still see the reply where they expect it (brief §9 tail step). Never
 * throws — a forward failure must not fail the whole event; the emails row
 * is already durably written by the time this runs.
 */
export async function forwardReceivingEmail(params: {
  emailId: string;
  to: string;
  from: string;
}): Promise<boolean> {
  try {
    const resend = getResendClient();
    if (!resend) return false;

    const { error } = await resend.emails.receiving.forward({
      emailId: params.emailId,
      to: params.to,
      from: params.from,
      passthrough: true,
    });

    if (error) {
      logger.warn({ err: error, emailId: params.emailId }, "resend.emails.receiving.forward failed (non-fatal)");
      return false;
    }
    return true;
  } catch (err) {
    logger.warn({ err, emailId: params.emailId }, "resend.emails.receiving.forward threw (non-fatal)");
    return false;
  }
}
