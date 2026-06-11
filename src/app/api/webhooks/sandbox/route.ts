// Sandbox inbound webhook receiver.
// GET  = hub-challenge verification handshake
// POST = fast-ack 200, enqueue each message to the events queue
//
// Never process inline before acking — slow webhooks get disabled.

import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { sandboxAdapter } from "@/lib/inbox/adapters/sandbox";
import { logger } from "@/lib/logger";

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const params: Record<string, string> = {};
  searchParams.forEach((v, k) => { params[k] = v; });

  // Look up the channel by external_account_id (provided as hub.topic or X-Channel-ID header)
  const channelId = request.headers.get("x-channel-id") ?? searchParams.get("channel_id");
  let verifyTokenHash: string | null = null;

  if (channelId) {
    const supabase = await createServiceClient();
    const { data } = await supabase
      .from("inbox_channels")
      .select("webhook_verify_token_hash")
      .eq("id", channelId)
      .eq("provider", "sandbox")
      .maybeSingle();
    verifyTokenHash = (data as { webhook_verify_token_hash?: string | null } | null)?.webhook_verify_token_hash ?? null;
  }

  const challenge = sandboxAdapter.verifyWebhook(params, verifyTokenHash);
  if (!challenge) {
    return new NextResponse("Forbidden", { status: 403 });
  }
  return new NextResponse(challenge, { status: 200 });
}

export async function POST(request: NextRequest) {
  // Read raw body for HMAC verification
  const rawBody = Buffer.from(await request.arrayBuffer());
  const sigHeader = request.headers.get("x-hub-signature-256");

  if (!sandboxAdapter.verifySignature(rawBody, sigHeader)) {
    logger.warn({ sig: sigHeader }, "sandbox webhook: invalid signature");
    return NextResponse.json({ error: "Invalid signature" }, { status: 403 });
  }

  let payload: unknown;
  try {
    payload = JSON.parse(rawBody.toString("utf8"));
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  // Identify tenant + channel from headers or payload
  const channelId = request.headers.get("x-channel-id");
  if (!channelId) {
    return NextResponse.json({ error: "Missing X-Channel-ID header" }, { status: 400 });
  }

  const supabase = await createServiceClient();

  const { data: channel } = await supabase
    .from("inbox_channels")
    .select("id, tenant_id, provider, external_account_id, status")
    .eq("id", channelId)
    .eq("provider", "sandbox")
    .maybeSingle();

  if (!channel || (channel as { status: string }).status !== "active") {
    // Fast-ack anyway so the sender doesn't get retried
    return NextResponse.json({ received: true }, { status: 200 });
  }

  const ch = channel as { id: string; tenant_id: string; provider: string; external_account_id: string };

  const messages = sandboxAdapter.parseInboundEvent(payload);

  // Enqueue each message as an inbox.inbound_received event
  const eventRows = messages.map((msg) => ({
    tenant_id: ch.tenant_id,
    type: "inbox.inbound_received",
    entity_type: "inbox_channel",
    entity_id: ch.id,
    payload: {
      channel_id: ch.id,
      tenant_id: ch.tenant_id,
      provider: ch.provider,
      external_contact_id: msg.externalContactId,
      contact_phone: msg.contactPhone,
      contact_display_name: msg.contactDisplayName,
      provider_message_id: msg.providerMessageId,
      provider_timestamp: msg.providerTimestamp,
      content_text: msg.contentText,
      attachments: msg.attachments,
    },
    status: "pending",
  }));

  if (eventRows.length > 0) {
    const { error } = await supabase.from("events").insert(eventRows);
    if (error) {
      logger.error({ err: error, channelId }, "sandbox webhook: failed to enqueue events");
    }
  }

  // Fast-ack 200
  return NextResponse.json({ received: true, enqueued: eventRows.length }, { status: 200 });
}
