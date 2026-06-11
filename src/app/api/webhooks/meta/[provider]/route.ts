// Meta webhook receiver — shape present; providers throw NOT_IMPLEMENTED.
// Activates when WhatsApp/Messenger/Instagram adapters are fully wired.
//
// GET  = hub-challenge verification
// POST = signature verify → fast-ack → enqueue to events

import { NextRequest, NextResponse } from "next/server";
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

  // All Meta providers share the same verify-token pattern.
  // Real implementation will call adapter.verifyWebhook() here.
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

  // Fast-ack 200 immediately — Meta disables slow webhooks.
  // Real processing: verify HMAC → parse → enqueue to events queue.
  // NOT_IMPLEMENTED until the provider adapters are enabled.
  logger.warn(
    { provider },
    "meta webhook: received POST but provider is not yet implemented — discarding"
  );

  return NextResponse.json({ received: true }, { status: 200 });
}
