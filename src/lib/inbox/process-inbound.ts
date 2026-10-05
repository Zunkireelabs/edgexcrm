// Async inbound processor — drained by src/app/api/internal/inbox/process/route.ts.
// Processes events of type 'inbox.inbound_received' from the events queue:
//   1. Idempotent message insert (partial-unique ON CONFLICT DO NOTHING)
//   2. find-or-create conversation (channel_id, external_contact_id)
//   3. Decision D: phone auto-link via normalizePhone (single match only, tenant-scoped)
//   4. Bump unread_count + last_message_*

import { createServiceClient } from "@/lib/supabase/server";
import { logger } from "@/lib/logger";
import { normalizePhone } from "@/lib/leads/dedup";
import { NotificationTypes, getTenantAdminRecipients, upsertThreadNotification } from "@/lib/notifications";
import { decryptToken } from "./crypto";
import { resolveAndStoreAttachments } from "./media";
import type { InboundMediaDescriptor } from "./adapters/types";

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
  attachments: InboundMediaDescriptor[];
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

  return runEventLoop(supabase, (events ?? []) as EventRow[]);
}

// By-id entry point for the webhook's post-response after() hook (S2-B): process only
// the event(s) that specific webhook call just inserted, never "drain N". Still filters
// on status='pending' so a row the */15 cron (or another after() call, in a retry) has
// already completed/failed isn't reset — and the message insert's ON CONFLICT DO NOTHING
// (channel_id, provider_message_id) makes a genuine race between this and the cron
// harmless either way: whichever runs second finds the row already handled.
export async function processInboundEventsByIds(ids: string[]): Promise<ProcessResult> {
  if (ids.length === 0) return { processed: 0, skipped: 0, errors: 0 };

  const supabase = await createServiceClient();

  const { data: events, error: fetchErr } = await supabase
    .from("events")
    .select("id, tenant_id, payload")
    .eq("type", "inbox.inbound_received")
    .eq("status", "pending")
    .in("id", ids);

  if (fetchErr) {
    logger.error({ err: fetchErr }, "processInboundEventsByIds: failed to fetch events");
    return { processed: 0, skipped: 0, errors: 1 };
  }

  return runEventLoop(supabase, (events ?? []) as EventRow[]);
}

async function runEventLoop(
  supabase: Awaited<ReturnType<typeof createServiceClient>>,
  events: EventRow[]
): Promise<ProcessResult> {
  let processed = 0;
  const skipped = 0;
  let errors = 0;

  if (events.length === 0) {
    return { processed: 0, skipped: 0, errors: 0 };
  }

  for (const evt of events) {
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
    .select("id, lead_id, unread_count, assigned_to_user_id, assignee_type")
    .eq("channel_id", p.channel_id)
    .eq("external_contact_id", p.external_contact_id)
    .maybeSingle();

  let conversationId: string;
  let currentUnread = 0;
  let convLeadId: string | null = null;
  let convAssigneeType = "unassigned";
  let convAssignedToUserId: string | null = null;

  if (existingConv) {
    const c = existingConv as { id: string; lead_id: string | null; unread_count: number; assigned_to_user_id: string | null; assignee_type: string };
    conversationId = c.id;
    currentUnread = c.unread_count;
    convLeadId = c.lead_id;
    convAssigneeType = c.assignee_type;
    convAssignedToUserId = c.assigned_to_user_id;

    // Decision D retry: the conversation existed (created before any lead matched, or
    // before this phone's lead was ever created) but still has no lead_id. Try again on
    // every subsequent inbound message — cheap (one indexed-ish LIKE/regex query) and the
    // only way an Admizz lead created AFTER the conversation ever gets linked. Never
    // overwrite an existing lead_id: `.is("lead_id", null)` on the UPDATE makes a race
    // against a concurrent manual link or another inbound event harmless (whichever write
    // lands second finds 0 rows and no-ops) rather than silently clobbering a human's choice.
    if (!convLeadId) {
      const retryLeadId = await resolveLeadByPhone(supabase, p.tenant_id, p.contact_phone);
      if (retryLeadId) {
        const { data: linked } = await supabase
          .from("conversations")
          .update({ lead_id: retryLeadId })
          .eq("id", conversationId)
          .eq("tenant_id", p.tenant_id)
          .is("lead_id", null)
          .select("id")
          .maybeSingle();
        if (linked) convLeadId = retryLeadId;
      }
    }
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
        .select("id, lead_id, unread_count, assigned_to_user_id, assignee_type")
        .eq("channel_id", p.channel_id)
        .eq("external_contact_id", p.external_contact_id)
        .maybeSingle();

      if (!raceConv) {
        throw new Error(`Failed to create conversation: ${createErr?.message}`);
      }
      const r = raceConv as { id: string; lead_id: string | null; unread_count: number; assigned_to_user_id: string | null; assignee_type: string };
      conversationId = r.id;
      currentUnread = r.unread_count;
      convLeadId = r.lead_id;
      convAssigneeType = r.assignee_type;
      convAssignedToUserId = r.assigned_to_user_id;
    } else {
      conversationId = (newConv as { id: string }).id;
      currentUnread = 0;
      convLeadId = resolvedLeadId;
      // New conversations always start unassigned
    }
  }

  // 2. Idempotent message insert — ON CONFLICT DO NOTHING (partial unique on channel_id + provider_message_id)
  // Persist the message FIRST with attachments empty; media is resolved AFTER and
  // patched in below. A failed media fetch must never cost the message its text
  // (docs/INBOX-ATTACHMENTS-BRIEF.md §5) — this ordering is what guarantees that even
  // if the resolve step throws, the message row insert above it has already landed.
  const { data: insertedMsg, error: msgErr } = await supabase
    .from("messages")
    .insert({
      tenant_id: p.tenant_id,
      conversation_id: conversationId,
      channel_id: p.channel_id,
      provider_message_id: p.provider_message_id,
      direction: "inbound",
      author_type: "customer",
      content_text: p.content_text ?? null,
      attachments: [],
      status: "received",
      provider_timestamp: p.provider_timestamp ?? null,
    })
    .select("id")
    .single();

  // UNIQUE conflict = already processed (idempotent)
  if (msgErr && msgErr.code !== "23505") {
    throw new Error(`Failed to insert message: ${msgErr.message}`);
  }

  const isDuplicate = msgErr?.code === "23505";
  if (isDuplicate) return;

  const messageId = (insertedMsg as { id: string }).id;

  // 2b. Resolve + persist any attachment descriptors (best-effort, never throws — see
  // media.ts). Only touches the network/channel token when there's actually media to
  // resolve, so the common text-only message pays zero extra cost.
  if (p.attachments.length > 0) {
    try {
      const { data: channelRow } = await supabase
        .from("inbox_channels")
        .select("access_token")
        .eq("id", p.channel_id)
        .maybeSingle();
      const encryptedToken = (channelRow as { access_token: string | null } | null)?.access_token;

      if (!encryptedToken) {
        throw new Error("channel has no access_token — cannot resolve inbound media");
      }
      const accessToken = decryptToken(encryptedToken);

      const resolved = await resolveAndStoreAttachments(p.attachments, {
        accessToken,
        tenantId: p.tenant_id,
        conversationId,
        messageId,
      });

      await supabase
        .from("messages")
        .update({ attachments: resolved })
        .eq("id", messageId)
        .eq("tenant_id", p.tenant_id);
    } catch (mediaErr) {
      // Couldn't even start resolving (no token / decrypt failure) — mark every
      // descriptor as failed rather than leaving attachments silently empty.
      const errMsg = mediaErr instanceof Error ? mediaErr.message : String(mediaErr);
      logger.error({ err: mediaErr, messageId, conversationId }, "processOneEvent: failed to resolve inbound media");
      await supabase
        .from("messages")
        .update({
          attachments: p.attachments.map((d) => ({
            type: d.type,
            provider_media_id: d.providerMediaId,
            filename: d.filename,
            mime_type: d.mimeType,
            error: errMsg,
          })),
        })
        .eq("id", messageId)
        .eq("tenant_id", p.tenant_id);
    }
  }

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

  // 4. Fire bell notification (non-fatal)
  try {
    const recipientIds = new Set<string>();

    if (convAssigneeType === "human" && convAssignedToUserId) {
      recipientIds.add(convAssignedToUserId);
    }

    if (convLeadId) {
      const { data: leadRow } = await supabase
        .from("leads")
        .select("assigned_to")
        .eq("id", convLeadId)
        .eq("tenant_id", p.tenant_id)
        .maybeSingle();
      if ((leadRow as { assigned_to?: string | null } | null)?.assigned_to) {
        recipientIds.add((leadRow as { assigned_to: string }).assigned_to);
      }
    }

    if (recipientIds.size === 0) {
      const admins = await getTenantAdminRecipients(supabase, p.tenant_id);
      admins.forEach((id) => recipientIds.add(id));
    }

    const preview = p.content_text?.slice(0, 200) ?? "";
    const senderLabel = p.contact_display_name || p.contact_phone || "Unknown";
    const link = `/inbox?conversation=${conversationId}`;

    await Promise.all(
      [...recipientIds].map((userId) =>
        upsertThreadNotification({
          tenantId: p.tenant_id,
          userId,
          type: NotificationTypes.INBOX_MESSAGE_RECEIVED,
          title: "New message",
          message: `${senderLabel}: ${preview}`,
          link,
        })
      )
    );
  } catch (notifyErr) {
    logger.warn({ err: notifyErr, conversation_id: conversationId }, "Failed to create inbox notification (non-fatal)");
  }
}

// Builds a Postgres POSIX regex (the `~` operator) that matches a phone value whose
// trailing digits — once any non-digit separators (spaces, dashes, parens, dots) are
// stripped out — equal `digits`. Unlike a plain `LIKE '%suffix'`, this still matches
// when the stored value has a separator INSIDE the trailing block, e.g. suffix
// "9812345678" against a stored "+977-981-2345678" (dash falls between digit 3 and 4
// of the local number) — a real, common Nepali formatting style LIKE cannot see
// because the literal substring "9812345678" never appears contiguously in that string.
// No new index/migration: same unindexed scan LIKE already did, just a different operator.
function buildSeparatorRobustSuffixRegex(digits: string): string {
  const digitPattern = digits.split("").join("[^0-9]*");
  return `${digitPattern}[^0-9]*$`;
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
  if (allDigits.length < 8) return null;

  const suffix = allDigits.length >= 10 ? allDigits.slice(-10) : allDigits;
  if (suffix.length < 7) return null;

  const { data: matches } = await supabase
    .from("leads")
    .select("id")
    .eq("tenant_id", tenantId)
    .is("deleted_at", null)
    .eq("is_final", true)
    .filter("phone", "match", buildSeparatorRobustSuffixRegex(suffix));

  if (!matches || matches.length !== 1) return null;
  return (matches[0] as { id: string }).id;
}
