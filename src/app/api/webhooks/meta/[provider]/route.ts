// Meta webhook receiver — handles WhatsApp (live); Messenger/Instagram remain stubs (3b/3c).
//
// GET  = hub-challenge verification (already real)
// POST = HMAC verify → parse → route to tenant by phone_number_id → enqueue to events
//
// Status callbacks (delivered/read) are processed here in 3a and patched forward-only.
// Choice logged in PR: shipping status updates in 3a keeps the route self-contained.
// If it balloons later, split into a dedicated status processor in 3b.

import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { getAdapter } from "@/lib/inbox/adapters";
import type { StatusEventResult } from "@/lib/inbox/adapters/types";
import { logger } from "@/lib/logger";

type MetaProvider = "whatsapp" | "messenger" | "instagram";

const SUPPORTED_PROVIDERS: MetaProvider[] = ["whatsapp", "messenger", "instagram"];

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ provider: string }> }
) {
  const { provider } = await params;

  if (!SUPPORTED_PROVIDERS.includes(provider as MetaProvider)) {
    return new NextResponse("Not Found", { status: 404 });
  }

  // Delegate handshake to the adapter so future providers can customise verify-token lookup.
  // For WhatsApp we still check META_WEBHOOK_VERIFY_TOKEN directly here — the adapter's
  // verifyWebhook() reads the same env var, but it throws if INBOX_WHATSAPP_ENABLED is unset.
  // To keep the webhook URL registerable before the flag is enabled, we implement the GET
  // check inline (matches the adapter logic exactly).
  const { searchParams } = new URL(request.url);
  const mode = searchParams.get("hub.mode");
  const token = searchParams.get("hub.verify_token");
  const challenge = searchParams.get("hub.challenge");

  const configToken = process.env.META_WEBHOOK_VERIFY_TOKEN;
  if (!configToken || mode !== "subscribe" || token !== configToken || !challenge) {
    return new NextResponse("Forbidden", { status: 403 });
  }

  return new NextResponse(challenge, { status: 200 });
}

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ provider: string }> }
) {
  const { provider } = await params;

  if (!SUPPORTED_PROVIDERS.includes(provider as MetaProvider)) {
    return NextResponse.json({ error: "Unknown provider" }, { status: 404 });
  }

  // Read raw body before anything else (required for HMAC verification)
  const rawBody = Buffer.from(await request.arrayBuffer());
  const sigHeader = request.headers.get("x-hub-signature-256");

  let adapter;
  try {
    adapter = getAdapter(provider as MetaProvider);
  } catch {
    // Provider not in registry (shouldn't happen with the guard above, but be safe)
    return NextResponse.json({ received: true }, { status: 200 });
  }

  // Verify HMAC signature — 403 on bad sig, always fast-ack on pass
  if (!adapter.verifySignature(rawBody, sigHeader)) {
    logger.warn({ provider, sig: sigHeader }, "meta webhook: invalid signature");
    return NextResponse.json({ error: "Invalid signature" }, { status: 403 });
  }

  let payload: unknown;
  try {
    payload = JSON.parse(rawBody.toString("utf8"));
  } catch {
    // Malformed body — fast-ack so Meta doesn't retry with the same bad payload
    logger.warn({ provider }, "meta webhook: invalid JSON body");
    return NextResponse.json({ received: true }, { status: 200 });
  }

  const supabase = await createServiceClient();

  // ── Status callbacks (delivered/read) ────────────────────────────────────────
  // Process forward-only: delivered → ok; read → ok; never downgrade read→delivered.
  let statusResults: StatusEventResult[];
  try {
    statusResults = adapter.parseStatusEvent(payload);
  } catch {
    statusResults = [];
  }

  if (statusResults.length > 0) {
    for (const s of statusResults) {
      const { data: msgRow } = await supabase
        .from("messages")
        .select("id, status, channel_id")
        .eq("provider_message_id", s.providerMessageId)
        .maybeSingle();

      if (!msgRow) continue;

      const row = msgRow as { id: string; status: string; channel_id: string };
      // Forward-only: skip if already at a higher rank
      const rank: Record<string, number> = { sent: 1, delivered: 2, read: 3 };
      if ((rank[row.status] ?? 0) >= (rank[s.status] ?? 0)) continue;

      const patch: Record<string, unknown> = { status: s.status };
      if (s.status === "delivered" && s.timestamp) patch.delivered_at = s.timestamp;
      if (s.status === "read" && s.timestamp) patch.read_at = s.timestamp;

      await supabase.from("messages").update(patch).eq("id", row.id);
    }
  }

  // ── Inbound messages ─────────────────────────────────────────────────────────
  let messages;
  try {
    messages = adapter.parseInboundEvent(payload);
  } catch {
    // Adapter not enabled (e.g. INBOX_WHATSAPP_ENABLED not set) — fast-ack
    return NextResponse.json({ received: true }, { status: 200 });
  }

  if (messages.length === 0) {
    return NextResponse.json({ received: true }, { status: 200 });
  }

  let enqueued = 0;

  for (const msg of messages) {
    // Route to tenant via inbox_channels(provider, external_account_id = channelRef)
    const { data: channelRow } = await supabase
      .from("inbox_channels")
      .select("id, tenant_id, provider, external_account_id, status")
      .eq("provider", provider)
      .eq("external_account_id", msg.channelRef)
      .maybeSingle();

    if (!channelRow || (channelRow as { status: string }).status !== "active") {
      // No channel connected or channel is inactive — silently drop (don't 500)
      logger.warn(
        { provider, channelRef: msg.channelRef },
        "meta webhook: no active channel for channelRef — dropping message"
      );
      continue;
    }

    const ch = channelRow as { id: string; tenant_id: string; provider: string; external_account_id: string };

    const { error } = await supabase.from("events").insert({
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
    });

    if (error) {
      logger.error({ err: error, channelId: ch.id }, "meta webhook: failed to enqueue event");
    } else {
      enqueued++;
    }
  }

  // Fast-ack 200 always — Meta disables slow webhooks
  return NextResponse.json({ received: true, enqueued }, { status: 200 });
}
