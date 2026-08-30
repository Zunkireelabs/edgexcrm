import { NextRequest } from "next/server";
import { requireEmailCampaignsAccess } from "@/lib/email/outbound/api-guard";
import { apiSuccess, apiNotFound, apiValidationError, apiConflict, apiServiceUnavailable } from "@/lib/api/response";
import { optionalMaxLength } from "@/lib/api/validation";
import { filterTreeSchema } from "@/lib/filters/schema";
import { createRequestLogger } from "@/lib/logger";

interface RouteParams {
  params: Promise<{ id: string }>;
}

interface BlastRow {
  id: string;
  status: string;
}

// GET /api/v1/email-blasts/[id]
export async function GET(_request: NextRequest, { params }: RouteParams) {
  const guard = await requireEmailCampaignsAccess();
  if (!guard.ok) return guard.response;
  const { db } = guard;
  const { id } = await params;

  const { data, error } = await db.from("email_blasts").select("*").eq("id", id).is("deleted_at", null).maybeSingle();
  if (error || !data) return apiNotFound("Email blast");
  return apiSuccess(data);
}

// PATCH /api/v1/email-blasts/[id] — only while status='draft'.
export async function PATCH(request: NextRequest, { params }: RouteParams) {
  const requestId = crypto.randomUUID();
  const log = createRequestLogger({ requestId, method: "PATCH", path: "/api/v1/email-blasts/[id]" });

  const guard = await requireEmailCampaignsAccess();
  if (!guard.ok) return guard.response;
  const { db } = guard;
  const { id } = await params;

  const { data: existing, error: fetchError } = await db
    .from("email_blasts")
    .select("id, status")
    .eq("id", id)
    .is("deleted_at", null)
    .maybeSingle();
  if (fetchError || !existing) return apiNotFound("Email blast");
  if ((existing as unknown as BlastRow).status !== "draft") {
    return apiConflict("Only a draft blast can be edited");
  }

  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object") return apiValidationError({ body: ["Request body must be a JSON object"] });
  const b = body as Record<string, unknown>;

  const patch: Record<string, unknown> = {};

  if (b.name !== undefined) {
    const err = optionalMaxLength(200)(b.name);
    if (err) return apiValidationError({ name: [err] });
    patch.name = b.name;
  }
  if (b.subject_template !== undefined) {
    const err = optionalMaxLength(200)(b.subject_template);
    if (err) return apiValidationError({ subject_template: [err] });
    patch.subject_template = b.subject_template;
  }
  if (b.body_template !== undefined) {
    patch.body_template = b.body_template;
  }
  if (b.from_name_override !== undefined) {
    const err = optionalMaxLength(120)(b.from_name_override);
    if (err) return apiValidationError({ from_name_override: [err] });
    patch.from_name_override = b.from_name_override;
  }
  if (b.audience_filter !== undefined) {
    const parsed = filterTreeSchema.safeParse(b.audience_filter);
    if (!parsed.success) {
      return apiValidationError({ audience_filter: [parsed.error.issues.map((i) => i.message).join("; ") || "invalid filter tree"] });
    }
    patch.audience_filter = parsed.data;
  }
  if (b.scheduled_for !== undefined) {
    patch.scheduled_for = b.scheduled_for;
  }

  if (Object.keys(patch).length === 0) return apiValidationError({ body: ["No editable fields provided"] });

  const { data, error } = await db.from("email_blasts").update(patch).eq("id", id).select("*").single();
  if (error) {
    log.error({ err: error }, "Failed to update email blast");
    return apiServiceUnavailable("Failed to update email blast");
  }

  return apiSuccess(data);
}

// DELETE /api/v1/email-blasts/[id] — remove a blast from the campaigns list.
//   • never-sent (no email_messages rows: every draft/scheduled, plus a blast
//     cancelled straight from draft)   -> HARD delete the row
//   • has send history (cancelled mid-send / sent / failed)  -> SOFT hide
//     (stamp deleted_at; keep the row + messages + stats for the record)
//   • in-flight (queued/sending/throttled)  -> 409, must /cancel first
//
// Before this, DELETE only flipped status to 'cancelled' and the list had no
// filter, so a "deleted" blast reappeared on refresh and an already-cancelled
// one could never be removed at all.
const IN_FLIGHT_STATUSES = new Set(["queued", "sending", "throttled"]);

export async function DELETE(_request: NextRequest, { params }: RouteParams) {
  const requestId = crypto.randomUUID();
  const log = createRequestLogger({ requestId, method: "DELETE", path: "/api/v1/email-blasts/[id]" });

  const guard = await requireEmailCampaignsAccess();
  if (!guard.ok) return guard.response;
  const { db } = guard;
  const { id } = await params;

  const { data: existing, error: fetchError } = await db
    .from("email_blasts")
    .select("id, status")
    .eq("id", id)
    .is("deleted_at", null)
    .maybeSingle();
  if (fetchError || !existing) return apiNotFound("Email blast");
  const status = (existing as unknown as BlastRow).status;

  if (IN_FLIGHT_STATUSES.has(status)) {
    return apiConflict("This blast is in progress — cancel it first, then delete it");
  }

  // email_messages has no FK back to email_blasts (soft source/source_id link,
  // see migration 211) — count directly instead of relying on a cascade.
  const { count: messageCount, error: countError } = await db
    .from("email_messages")
    .select("id", { count: "exact", head: true })
    .eq("source", "blast")
    .eq("source_id", id);
  if (countError) {
    log.error({ err: countError }, "Failed to check email blast messages before delete");
    return apiServiceUnavailable("Failed to delete email blast");
  }

  if ((messageCount ?? 0) === 0) {
    // Never materialized a recipient — safe to remove entirely. Clear any stray
    // messages defensively (there should be none) before dropping the row.
    await db.from("email_messages").delete().eq("source", "blast").eq("source_id", id);
    const { error: deleteError } = await db.from("email_blasts").delete().eq("id", id);
    if (deleteError) {
      log.error({ err: deleteError }, "Failed to hard-delete email blast");
      return apiServiceUnavailable("Failed to delete email blast");
    }
    return apiSuccess({ id, deleted: true });
  }

  const { data, error } = await db
    .from("email_blasts")
    .update({ deleted_at: new Date().toISOString() })
    .eq("id", id)
    .select("*")
    .single();
  if (error) {
    log.error({ err: error }, "Failed to soft-delete email blast");
    return apiServiceUnavailable("Failed to delete email blast");
  }

  return apiSuccess(data);
}
