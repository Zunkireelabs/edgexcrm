// Chatwoot webhook receiver (website chat, Phase 1: receive only).
// See docs/CHATWOOT-WEBSITE-CHAT-BRIEF.md.
//
// POST = find the channel from the payload's account+inbox ids → verify Chatwoot's signed
//        webhook with THAT channel's secret → parse → enqueue to events → process after the
//        response (same hand-off as the Meta route; the */15 cron is the safety net).
//
// Responses are deliberately uniform: an unknown channel and a bad signature both return the
// same 401, so the route cannot be used to discover which Chatwoot account/inbox ids are
// connected. Fail-closed: disabled by default (INBOX_CHATWOOT_ENABLED must be "true").

import { NextRequest, NextResponse, after } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { logger } from "@/lib/logger";
import { decryptToken } from "@/lib/inbox/crypto";
import { processInboundEventsByIds } from "@/lib/inbox/process-inbound";
import { chatwootAdapter, chatwootChannelRefFromPayload, verifyChatwootSignature } from "@/lib/inbox/adapters/chatwoot";

const UNAUTHORIZED = () => NextResponse.json({ error: "Invalid signature" }, { status: 401 });

interface ChatwootChannelRow {
  id: string;
  tenant_id: string;
  provider: string;
  status: string;
  meta: { webhook_secret_enc?: string } | null;
}

export async function POST(request: NextRequest) {
  if (process.env.INBOX_CHATWOOT_ENABLED !== "true") {
    return new NextResponse("Not Found", { status: 404 });
  }

  // Raw body first: the signature covers the exact bytes Chatwoot sent.
  const rawBody = Buffer.from(await request.arrayBuffer());

  let payload: unknown;
  try {
    payload = JSON.parse(rawBody.toString("utf8"));
  } catch (err) {
    // Sizes and the parse error only — never the body, which holds visitor messages.
    logger.warn(
      {
        err: err instanceof Error ? err.message : String(err),
        bodyBytes: rawBody.length,
        contentLength: request.headers.get("content-length"),
        contentType: request.headers.get("content-type"),
        transferEncoding: request.headers.get("transfer-encoding"),
      },
      "chatwoot webhook: invalid JSON body"
    );
    return NextResponse.json({ received: true }, { status: 200 });
  }

  const channelRef = chatwootChannelRefFromPayload(payload);
  if (!channelRef) return UNAUTHORIZED();

  const supabase = await createServiceClient();
  const { data: channelData } = await supabase
    .from("inbox_channels")
    .select("id, tenant_id, provider, status, meta")
    .eq("provider", "chatwoot")
    .eq("external_account_id", channelRef)
    .maybeSingle();

  const channel = channelData as ChatwootChannelRow | null;
  const encryptedSecret = channel?.meta?.webhook_secret_enc;
  if (!channel || channel.status !== "active" || !encryptedSecret) {
    logger.warn({ channelRef }, "chatwoot webhook: no active channel with a secret for this account/inbox");
    return UNAUTHORIZED();
  }

  let secret: string;
  try {
    secret = decryptToken(encryptedSecret);
  } catch (err) {
    logger.error({ err, channelId: channel.id }, "chatwoot webhook: cannot decrypt channel secret");
    return UNAUTHORIZED();
  }

  const verified = verifyChatwootSignature({
    rawBody,
    timestampHeader: request.headers.get("x-chatwoot-timestamp"),
    signatureHeader: request.headers.get("x-chatwoot-signature"),
    secret,
  });
  if (!verified) {
    logger.warn({ channelId: channel.id }, "chatwoot webhook: invalid or stale signature");
    return UNAUTHORIZED();
  }

  // Only visitor messages become inbound records; every other event type is acknowledged.
  const messages = chatwootAdapter.parseInboundEvent(payload);
  if (messages.length === 0) {
    return NextResponse.json({ received: true, enqueued: 0 }, { status: 200 });
  }

  const enqueuedEventIds: string[] = [];
  for (const msg of messages) {
    const { data: inserted, error } = await supabase
      .from("events")
      .insert({
        tenant_id: channel.tenant_id,
        type: "inbox.inbound_received",
        entity_type: "inbox_channel",
        entity_id: channel.id,
        payload: {
          channel_id: channel.id,
          tenant_id: channel.tenant_id,
          provider: channel.provider,
          external_contact_id: msg.externalContactId,
          contact_phone: msg.contactPhone,
          contact_email: msg.contactEmail ?? null,
          contact_display_name: msg.contactDisplayName,
          provider_message_id: msg.providerMessageId,
          provider_timestamp: msg.providerTimestamp,
          content_text: msg.contentText,
          attachments: msg.attachments,
        },
        status: "pending",
      })
      .select("id")
      .single();

    if (error || !inserted) {
      logger.error({ err: error, channelId: channel.id }, "chatwoot webhook: failed to enqueue event");
    } else {
      enqueuedEventIds.push((inserted as { id: string }).id);
    }
  }

  if (enqueuedEventIds.length > 0) {
    after(async () => {
      try {
        await processInboundEventsByIds(enqueuedEventIds);
      } catch (err) {
        logger.error({ err, eventIds: enqueuedEventIds }, "chatwoot webhook: after() inbound processing failed");
      }
    });
  }

  return NextResponse.json({ received: true, enqueued: enqueuedEventIds.length }, { status: 200 });
}
