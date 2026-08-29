// Resend delivery/bounce/complaint webhook — fast-ack, verify-first, mirrors
// the shape of src/app/api/webhooks/email/inbound/route.ts (brief §7).
//
// 1. Read raw bytes BEFORE any parse — svix signs the exact bytes.
// 2. Verify against RESEND_EVENTS_WEBHOOK_SECRET — a SEPARATE secret from
//    RESEND_INBOUND_WEBHOOK_SECRET (different Resend webhook, different
//    signing key). Bad/missing signature -> 403, never process.
// 3. Match the event to a row by provider_message_id. The TENANT IS DERIVED
//    FROM THAT ROW, never from the payload — the payload is
//    attacker-controllable if the signature check is ever weakened.
// 4. Unknown event type or unmatched message id -> 200, no-op. Never 500 on
//    a webhook; Resend retries and amplifies our own problem.
// 5. Always an identical `200 {received:true}` after verification, matched
//    or not.

import { NextRequest, NextResponse } from "next/server";
import type { WebhookEventPayload } from "resend";
import { createServiceClient } from "@/lib/supabase/server";
import { scopedClientForTenant } from "@/lib/supabase/scoped";
import { getResendClient } from "@/lib/email";
import { suppressEmail } from "@/lib/email/outbound/suppression";
import { logger } from "@/lib/logger";

const ACK = { received: true } as const;

// Repeated soft/transient bounces escalate to a permanent suppression on the
// Nth one — a single soft bounce is usually transient (mailbox full, greylist
// retry), but a pattern of them is a dead address in practice.
const SOFT_BOUNCE_SUPPRESS_THRESHOLD = 3;

const HANDLED_EVENT_TYPES = new Set(["email.sent", "email.delivered", "email.bounced", "email.complained"]);

interface EmailMessageRow {
  id: string;
  tenant_id: string;
  to_email: string;
  lead_id: string | null;
}

type BounceClassification = "hard" | "soft" | "ambiguous";

// Resend's bounce.type mirrors AWS SES's three-way classification
// (Permanent / Transient / Undetermined) — see the events appendix in
// docs/OUTREACH-PHASE0-BRIEF.md for the exact payload shapes this codebase
// has actually observed.
function classifyBounce(bounce: { type?: string; subType?: string } | undefined): BounceClassification {
  const type = (bounce?.type || "").toLowerCase();
  if (type.includes("permanent")) return "hard";
  if (type.includes("transient")) return "soft";
  return "ambiguous";
}

export async function POST(request: NextRequest) {
  // svix signs the exact bytes — read before any parsing.
  const rawBody = Buffer.from(await request.arrayBuffer());

  const svixId = request.headers.get("svix-id");
  const svixTimestamp = request.headers.get("svix-timestamp");
  const svixSignature = request.headers.get("svix-signature");
  const webhookSecret = process.env.RESEND_EVENTS_WEBHOOK_SECRET;

  if (!webhookSecret || !svixId || !svixTimestamp || !svixSignature) {
    logger.warn("email events webhook: missing signature headers or RESEND_EVENTS_WEBHOOK_SECRET");
    return NextResponse.json({ error: "Invalid signature" }, { status: 403 });
  }

  const resend = getResendClient();
  if (!resend) {
    logger.error("email events webhook: RESEND_API_KEY not configured");
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
    logger.warn({ err }, "email events webhook: signature verification failed");
    return NextResponse.json({ error: "Invalid signature" }, { status: 403 });
  }

  if (!HANDLED_EVENT_TYPES.has(event.type)) {
    return NextResponse.json(ACK, { status: 200 });
  }

  const emailId = (event.data as { email_id: string }).email_id;
  const supabase = await createServiceClient();

  const { data: matched } = await supabase
    .from("email_messages")
    .select("id, tenant_id, to_email, lead_id")
    .eq("provider_message_id", emailId)
    .maybeSingle();

  if (!matched) {
    logger.warn({ emailId, eventType: event.type }, "email events webhook: no matching email_messages row for provider_message_id");
    return NextResponse.json(ACK, { status: 200 });
  }

  const row = matched as EmailMessageRow;
  const db = await scopedClientForTenant(row.tenant_id);
  const nowIso = new Date().toISOString();

  switch (event.type) {
    case "email.sent":
      // Already 'sent' from send.ts at submission time — no-op, just an ack.
      break;

    case "email.delivered":
      await db.from("email_messages").update({ status: "delivered", delivered_at: nowIso }).eq("id", row.id);
      break;

    case "email.bounced": {
      const classification = classifyBounce(event.data.bounce);
      await db.from("email_messages").update({ status: "bounced", bounced_at: nowIso }).eq("id", row.id);

      if (classification === "hard") {
        await suppressEmail(db, row.tenant_id, {
          email: row.to_email,
          reason: "hard_bounce",
          source: "webhook_bounce",
          leadId: row.lead_id,
        });
      } else if (classification === "soft") {
        const { count } = await db
          .from("email_messages")
          .select("id", { count: "exact", head: true })
          .eq("to_email", row.to_email)
          .eq("status", "bounced");

        if ((count ?? 0) >= SOFT_BOUNCE_SUPPRESS_THRESHOLD) {
          await suppressEmail(db, row.tenant_id, {
            email: row.to_email,
            reason: "hard_bounce",
            source: "webhook_bounce_soft_threshold",
            leadId: row.lead_id,
            note: `Suppressed after ${count} soft bounces.`,
          });
        }
      } else {
        // Ambiguous classification: NEVER suppress. Wrongly suppressing
        // permanently silences a real recipient, which is worse than one
        // extra retry (§7, brief).
        logger.warn(
          { emailId, tenantId: row.tenant_id, bounceType: event.data.bounce?.type },
          "email events webhook: ambiguous bounce classification — not suppressing"
        );
      }
      break;
    }

    case "email.complained":
      // A spam complaint is unambiguous — always suppress, no threshold.
      await suppressEmail(db, row.tenant_id, {
        email: row.to_email,
        reason: "complaint",
        source: "webhook_complaint",
        leadId: row.lead_id,
      });
      await db.from("email_messages").update({ status: "complained" }).eq("id", row.id);
      break;
  }

  return NextResponse.json(ACK, { status: 200 });
}
