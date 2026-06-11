// Async inbound processor — drained by src/app/api/internal/inbox/process/route.ts.
// Processes events of type 'inbox.inbound_received' from the events queue:
//   1. Idempotent message insert (partial-unique ON CONFLICT DO NOTHING)
//   2. find-or-create conversation (channel_id, external_contact_id)
//   3. Decision D: phone auto-link via normalizePhone (single match only, tenant-scoped)
//   4. Bump unread_count + last_message_*

import { createServiceClient } from "@/lib/supabase/server";
import { logger } from "@/lib/logger";
import { normalizePhone } from "@/lib/leads/dedup";

interface InboundEventPayload {
  channel_id: string;
  tenant_id: string;
  provider: string;
  external_contact_id: string;
  contact_phone: string | null;
  contact_display_name: string | null;
  provider_message_id: string;
  provider_timestamp: string | null;
  content_text: string | null;
  attachments: unknown[];
}

interface EventRow {
  id: string;
  tenant_id: string;
  payload: InboundEventPayload;
}

interface ProcessResult {
  processed: number;
  skipped: number;
  errors: number;
}

export async function processInboundEvents(limit = 50): Promise<ProcessResult> {
  const supabase = await createServiceClient();
  let processed = 0;
  const skipped = 0;
  let errors = 0;

  // Fetch pending inbox.inbound_received events
  const { data: events, error: fetchErr } = await supabase
    .from("events")
    .select("id, tenant_id, payload")
    .eq("type", "inbox.inbound_received")
    .eq("status", "pending")
    .order("created_at", { ascending: true })
    .limit(limit);

  if (fetchErr) {
    logger.error({ err: fetchErr }, "processInboundEvents: failed to fetch events");
    return { processed: 0, skipped: 0, errors: 1 };
  }

  if (!events || events.length === 0) {
    return { processed: 0, skipped: 0, errors: 0 };
  }

  for (const evt of events as EventRow[]) {
    try {
      await processOneEvent(supabase, evt);
      await supabase
        .from("events")
        .update({ status: "completed" })
        .eq("id", evt.id);
      processed++;
    } catch (err) {
      errors++;
      const errMsg = err instanceof Error ? err.message : String(err);
      logger.error({ err, eventId: evt.id }, "processInboundEvents: failed to process event");
      // Increment attempt counter; leave as pending for retry up to MAX attempts (mig 002 attempts column)
      const { data: current } = await supabase
        .from("events")
        .select("attempts")
        .eq("id", evt.id)
        .single();
      const attempts = ((current as { attempts?: number } | null)?.attempts ?? 0) + 1;
      await supabase
        .from("events")
        .update({
          last_error: errMsg,
          attempts,
          status: attempts >= 3 ? "failed" : "pending",
        })
        .eq("id", evt.id);
    }
  }

  return { processed, skipped, errors };
}

async function processOneEvent(
  supabase: Awaited<ReturnType<typeof createServiceClient>>,
  evt: EventRow
): Promise<void> {
  const p = evt.payload;
  if (!p.channel_id || !p.tenant_id || !p.external_contact_id || !p.provider_message_id) {
    throw new Error("Invalid inbox.inbound_received payload: missing required fields");
  }

  // 1. find-or-create conversation
  const { data: existingConv } = await supabase
    .from("conversations")
    .select("id, lead_id, unread_count")
    .eq("channel_id", p.channel_id)
    .eq("external_contact_id", p.external_contact_id)
    .maybeSingle();

  let conversationId: string;
  let currentUnread = 0;

  if (existingConv) {
    conversationId = (existingConv as { id: string; lead_id: string | null; unread_count: number }).id;
    currentUnread = (existingConv as { id: string; lead_id: string | null; unread_count: number }).unread_count;
  } else {
    // Create new conversation; attempt phone-based lead linkage (Decision D)
    const resolvedLeadId = await resolveLeadByPhone(supabase, p.tenant_id, p.contact_phone);

    const { data: newConv, error: createErr } = await supabase
      .from("conversations")
      .insert({
        tenant_id: p.tenant_id,
        channel_id: p.channel_id,
        provider: p.provider,
        external_contact_id: p.external_contact_id,
        contact_phone: p.contact_phone ?? null,
        contact_display_name: p.contact_display_name ?? null,
        lead_id: resolvedLeadId,
        unread_count: 0,
        last_message_at: p.provider_timestamp ?? new Date().toISOString(),
        last_message_preview: p.content_text?.slice(0, 200) ?? null,
        last_message_direction: "inbound",
      })
      .select("id")
      .single();

    if (createErr || !newConv) {
      // May be a race — try to fetch again
      const { data: raceConv } = await supabase
        .from("conversations")
        .select("id, lead_id, unread_count")
        .eq("channel_id", p.channel_id)
        .eq("external_contact_id", p.external_contact_id)
        .maybeSingle();

      if (!raceConv) {
        throw new Error(`Failed to create conversation: ${createErr?.message}`);
      }
      conversationId = (raceConv as { id: string; lead_id: string | null; unread_count: number }).id;
      currentUnread = (raceConv as { id: string; lead_id: string | null; unread_count: number }).unread_count;
    } else {
      conversationId = (newConv as { id: string }).id;
      currentUnread = 0;
    }
  }

  // 2. Idempotent message insert — ON CONFLICT DO NOTHING (partial unique on channel_id + provider_message_id)
  const { error: msgErr } = await supabase
    .from("messages")
    .insert({
      tenant_id: p.tenant_id,
      conversation_id: conversationId,
      channel_id: p.channel_id,
      provider_message_id: p.provider_message_id,
      direction: "inbound",
      author_type: "customer",
      content_text: p.content_text ?? null,
      attachments: p.attachments ?? [],
      status: "received",
      provider_timestamp: p.provider_timestamp ?? null,
    });

  // UNIQUE conflict = already processed (idempotent)
  if (msgErr && msgErr.code !== "23505") {
    throw new Error(`Failed to insert message: ${msgErr.message}`);
  }

  const isDuplicate = msgErr?.code === "23505";
  if (isDuplicate) return;

  // 3. Bump unread_count + last_message_*
  await supabase
    .from("conversations")
    .update({
      unread_count: currentUnread + 1,
      last_message_at: p.provider_timestamp ?? new Date().toISOString(),
      last_message_preview: p.content_text?.slice(0, 200) ?? null,
      last_message_direction: "inbound",
    })
    .eq("id", conversationId)
    .eq("tenant_id", p.tenant_id);
}

// Decision D: match incoming phone to exactly ONE existing lead by trailing digits.
// 0 matches or >1 matches → null (never auto-create).
async function resolveLeadByPhone(
  supabase: Awaited<ReturnType<typeof createServiceClient>>,
  tenantId: string,
  rawPhone: string | null
): Promise<string | null> {
  if (!rawPhone) return null;

  const normalized = normalizePhone(rawPhone);
  if (!normalized) return null;

  const allDigits = normalized.replace(/\D/g, "");
  const suffix = allDigits.length >= 10 ? allDigits.slice(-10) : allDigits;
  if (suffix.length < 7) return null;

  const { data: matches } = await supabase
    .from("leads")
    .select("id")
    .eq("tenant_id", tenantId)
    .is("deleted_at", null)
    .eq("is_final", true)
    .like("phone", `%${suffix}`);

  if (!matches || matches.length !== 1) return null;
  return (matches[0] as { id: string }).id;
}
