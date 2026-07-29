// Resend inbound-email webhook — fast-ack, verify-first (brief §7).
//
// 1. Read raw bytes BEFORE any parse — svix signs the exact bytes.
// 2. resend.webhooks.verify() (svix under the hood). Throws on bad sig -> 403,
//    never enqueue.
// 3. Non-'email.received' event types -> 200, no-op.
// 4. Resolve tenant via resolveInboundRecipients() (brief §8) — this is the
//    ONLY tenant-resolution path; never From:, never a header, never the body.
// 5. Always `200 {received:true}` — identical response matched or not, so
//    there is no token-enumeration oracle.
// 6. NEVER call resend.emails.receiving.get() here — body fetch happens in
//    the Inngest processor (process-inbound.ts), off the request path.

import { NextRequest, NextResponse } from "next/server";
import type { WebhookEventPayload } from "resend";
import { createServiceClient } from "@/lib/supabase/server";
import { getResendClient } from "@/lib/email";
import { resolveInboundRecipients } from "@/lib/email/inbound/resolve";
import { logger } from "@/lib/logger";

const ACK = { received: true } as const;

export async function POST(request: NextRequest) {
  // svix signs the exact bytes — read before any parsing.
  const rawBody = Buffer.from(await request.arrayBuffer());

  const svixId = request.headers.get("svix-id");
  const svixTimestamp = request.headers.get("svix-timestamp");
  const svixSignature = request.headers.get("svix-signature");
  const webhookSecret = process.env.RESEND_INBOUND_WEBHOOK_SECRET;

  if (!webhookSecret || !svixId || !svixTimestamp || !svixSignature) {
    logger.warn("email inbound webhook: missing signature headers or RESEND_INBOUND_WEBHOOK_SECRET");
    return NextResponse.json({ error: "Invalid signature" }, { status: 403 });
  }

  const resend = getResendClient();
  if (!resend) {
    logger.error("email inbound webhook: RESEND_API_KEY not configured");
    return NextResponse.json({ error: "Invalid signature" }, { status: 403 });
  }

  let event: WebhookEventPayload;
  try {
    event = resend.webhooks.verify({
      payload: rawBody.toString("utf8"),
      headers: { id: svixId, timestamp: svixTimestamp, signature: svixSignature },
      webhookSecret,
    });
  } catch (err) {
    logger.warn({ err }, "email inbound webhook: signature verification failed");
    return NextResponse.json({ error: "Invalid signature" }, { status: 403 });
  }

  if (event.type !== "email.received") {
    return NextResponse.json(ACK, { status: 200 });
  }

  const { email_id: resendEmailId, from, to, cc, bcc, subject } = event.data;

  const result = await resolveInboundRecipients({ to, cc, bcc });

  const supabase = await createServiceClient();

  for (const match of result.matches) {
    const { error } = await supabase.from("events").insert({
      tenant_id: match.tenantId,
      type: "email.inbound_received",
      entity_type: "inbound_address",
      entity_id: match.id,
      payload: {
        resend_email_id: resendEmailId,
        tenant_id: match.tenantId,
        inbound_address_id: match.id,
        kind: match.kind,
        verb: match.verb,
        thread_id: match.threadId,
        user_id: match.userId,
        envelope: { to, cc, bcc, from, subject },
      },
      status: "pending",
    });
    if (error) {
      logger.error({ err: error, matchId: match.id }, "email inbound webhook: failed to enqueue event");
    }
  }

  // Zero matches: only dead-letter when a candidate looked like a real,
  // well-formed EdgeX token that simply didn't resolve (revoked/unknown/
  // rate-limited) — resolveInboundRecipients() already excludes cross-
  // environment and cross-domain junk from this bucket (brief §8), so this
  // never captures a sibling environment's mail.
  if (result.matches.length === 0 && result.hadCandidateButNoMatch) {
    const { error } = await supabase.from("inbound_email_dead_letter").insert({
      tenant_id: null,
      provider_message_id: resendEmailId,
      from_address: from,
      to_addresses: to,
      subject,
      reason: "no_token",
      raw_event: event as unknown as Record<string, unknown>,
    });
    // provider_message_id is UNIQUE — a redelivered event is a no-op, not an error.
    if (error && error.code !== "23505") {
      logger.error({ err: error }, "email inbound webhook: failed to write dead-letter");
    }
  }

  return NextResponse.json(ACK, { status: 200 });
}
