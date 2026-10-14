import { NextRequest } from "next/server";
import { authenticateRequest } from "@/lib/api/auth";
import { shouldRestrictToSelf } from "@/lib/api/permissions";
import {
  apiSuccess,
  apiUnauthorized,
  apiForbidden,
  apiNotFound,
  apiError,
  apiConflict,
  apiValidationError,
  apiServiceUnavailable,
} from "@/lib/api/response";
import { validate, required, isUUID } from "@/lib/api/validation";
import { createRequestLogger } from "@/lib/logger";
import { scopedClient, type ScopedClient } from "@/lib/supabase/scoped";
import { getFeatureAccess } from "@/industries/_loader";
import { FEATURES } from "@/industries/_registry";
import { channelOf } from "@/industries/_shared/features/outreach/lib/channel";
import { queueNextSequence, startQueuedEnrollment } from "@/industries/_shared/features/outreach/lib/queue-next";
import { toProviderRecipient } from "@/lib/sms/phone";

// POST   /api/v1/leads/[id]/subscriptions/queue  { sequence_id }  — "Queue next": start this sequence when the lead's current
//        sequence ON THE SAME CHANNEL ends (a lead runs at most one email and one SMS sequence at a time, migrations 176/274).
// DELETE /api/v1/leads/[id]/subscriptions/queue?queue_id=…         — take a waiting sequence off the queue.
//
// Uses the existing queue (sequence_enrollment_queue, migrations 259/275, the same one bulk enroll's "queue" option fills); the engine
// starts the queued sequence when the current one completes, is unenrolled or is ended by a reply. Access is the same as enrolling a
// lead (POST /api/v1/outreach/enrollments): outreach tenants only, and an own-scope counselor only for a lead assigned to them.

interface Props {
  params: Promise<{ id: string }>;
}

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

type LeadRow = { id: string; assigned_to: string | null; phone: string | null };

/** The lead, if this user may change its outreach; otherwise the response to send. */
async function loadLead(db: ScopedClient, auth: { userId: string; permissions: Parameters<typeof shouldRestrictToSelf>[0] }, id: string) {
  const { data } = await db.from("leads").select("id, assigned_to, phone").eq("id", id).is("deleted_at", null).maybeSingle();
  const lead = data as unknown as LeadRow | null;
  // Same as enrolling: a counselor limited to their own leads gets a plain "not found" for anyone else's (nothing revealed).
  if (!lead || (shouldRestrictToSelf(auth.permissions) && lead.assigned_to !== auth.userId)) return null;
  return lead;
}

async function liveEnrollment(db: ScopedClient, leadId: string, channel: string) {
  const { data, error } = await db
    .from("sequence_enrollments")
    .select("id, sequence_id")
    .eq("lead_id", leadId)
    .eq("channel", channel)
    .in("status", ["active", "paused"])
    .maybeSingle();
  return { live: data as unknown as { id: string; sequence_id: string } | null, error };
}

export async function POST(request: NextRequest, { params }: Props) {
  const { id } = await params;
  const requestId = crypto.randomUUID();
  const log = createRequestLogger({ requestId, method: "POST", path: `/api/v1/leads/${id}/subscriptions/queue` });

  const auth = await authenticateRequest();
  if (!auth) return apiUnauthorized();
  if (!getFeatureAccess(auth.industryId, FEATURES.OUTREACH)) return apiForbidden();
  if (!UUID_REGEX.test(id)) return apiValidationError({ id: ["Invalid lead id"] });

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return apiError("INVALID_JSON", "Request body must be valid JSON", 400);
  }
  const { valid, errors } = validate(body, { sequence_id: [required("sequence_id"), isUUID()] });
  if (!valid) return apiValidationError(errors);
  const sequenceId = String(body.sequence_id);

  const db = await scopedClient(auth);
  const lead = await loadLead(db, auth, id);
  if (!lead) return apiNotFound("Lead");

  const { data: seq } = await db.from("email_sequences").select("id, status, channel").eq("id", sequenceId).maybeSingle();
  const sequence = seq as unknown as { id: string; status: string; channel?: string | null } | null;
  if (!sequence || sequence.status !== "active") return apiNotFound("Sequence");
  const channel = channelOf(sequence);

  // Same check as enrolling: a text sequence for a lead we cannot text could never send a single step.
  if (channel === "sms" && !toProviderRecipient(lead.phone).ok) {
    return apiError("NO_PHONE", "This lead has no valid phone number, so they can't be added to an SMS sequence.", 422);
  }

  const { live, error: liveError } = await liveEnrollment(db, lead.id, channel);
  if (liveError) return apiServiceUnavailable("Failed to queue the sequence");
  // Queue is only for a busy channel; a free one is a plain Enroll (POST /api/v1/outreach/enrollments) — say so instead of parking it.
  if (!live) {
    return apiConflict(`This lead isn't in ${channel === "sms" ? "an SMS" : "an email"} sequence right now — enroll them instead.`);
  }
  if (live.sequence_id === sequenceId) return apiConflict("This lead is already running this sequence.");

  let result: "queued" | "already_queued";
  try {
    result = await queueNextSequence(db, { leadId: lead.id, sequenceId, queuedBy: auth.userId, runId: null });
  } catch (err) {
    log.error({ err, leadId: lead.id }, "Failed to queue the next sequence");
    return apiServiceUnavailable("Failed to queue the sequence");
  }
  if (result === "already_queued") {
    return apiConflict(
      `This lead already has ${channel === "sms" ? "an SMS" : "an email"} sequence waiting. Remove it from the queue first to queue a different one.`,
    );
  }

  // The current sequence may have ended between the check above and the insert; then nothing would ever start the queued one —
  // start it now (startQueuedEnrollment is the engine's own "an enrollment ended" step and never throws for expected cases).
  const after = await liveEnrollment(db, lead.id, channel);
  const started = !after.error && !after.live ? await startQueuedEnrollment(auth.tenantId, lead.id, channel) : "waiting";

  log.info({ leadId: lead.id, sequenceId, channel, started }, "Sequence queued next");
  return apiSuccess({ queued: true, startedNow: started === "started" }, 201);
}

export async function DELETE(request: NextRequest, { params }: Props) {
  const { id } = await params;
  const log = createRequestLogger({ requestId: crypto.randomUUID(), method: "DELETE", path: `/api/v1/leads/${id}/subscriptions/queue` });

  const auth = await authenticateRequest();
  if (!auth) return apiUnauthorized();
  if (!getFeatureAccess(auth.industryId, FEATURES.OUTREACH)) return apiForbidden();
  if (!UUID_REGEX.test(id)) return apiValidationError({ id: ["Invalid lead id"] });
  const queueId = new URL(request.url).searchParams.get("queue_id") ?? "";
  if (!UUID_REGEX.test(queueId)) return apiValidationError({ queue_id: ["Invalid queue id"] });

  const db = await scopedClient(auth);
  const lead = await loadLead(db, auth, id);
  if (!lead) return apiNotFound("Lead");

  // Only a still-waiting row of THIS lead: never touches another lead's queue, never "un-starts" one that already began.
  const { data, error } = await db
    .from("sequence_enrollment_queue")
    .update({ status: "cancelled", reason: "Removed from the lead page" })
    .eq("id", queueId)
    .eq("lead_id", lead.id)
    .eq("status", "waiting")
    .select("id");
  if (error) {
    log.error({ leadId: lead.id, queueId }, "Failed to remove the queued sequence");
    return apiServiceUnavailable("Failed to remove the queued sequence");
  }
  if (!data || (data as unknown[]).length === 0) return apiNotFound("Queued sequence");
  return apiSuccess({ removed: true });
}
