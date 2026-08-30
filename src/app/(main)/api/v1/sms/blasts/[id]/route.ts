import { NextRequest } from "next/server";
import { requireSmsAccess } from "@/lib/sms/api-guard";
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

// GET /api/v1/sms/blasts/[id]
export async function GET(_request: NextRequest, { params }: RouteParams) {
  const guard = await requireSmsAccess();
  if (!guard.ok) return guard.response;
  const { db } = guard;
  const { id } = await params;

  const { data, error } = await db.from("sms_blasts").select("*").eq("id", id).is("deleted_at", null).maybeSingle();
  if (error || !data) return apiNotFound("SMS blast");
  return apiSuccess(data);
}

// PATCH /api/v1/sms/blasts/[id] — only while status='draft'.
export async function PATCH(request: NextRequest, { params }: RouteParams) {
  const requestId = crypto.randomUUID();
  const log = createRequestLogger({ requestId, method: "PATCH", path: "/api/v1/sms/blasts/[id]" });

  const guard = await requireSmsAccess();
  if (!guard.ok) return guard.response;
  const { db } = guard;
  const { id } = await params;

  const { data: existing, error: fetchError } = await db
    .from("sms_blasts")
    .select("id, status")
    .eq("id", id)
    .is("deleted_at", null)
    .maybeSingle();
  if (fetchError || !existing) return apiNotFound("SMS blast");
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
  if (b.body !== undefined) {
    const err = optionalMaxLength(1200)(b.body);
    if (err) return apiValidationError({ body: [err] });
    patch.body = b.body;
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

  const { data, error } = await db.from("sms_blasts").update(patch).eq("id", id).select("*").single();
  if (error) {
    log.error({ err: error }, "Failed to update sms blast");
    return apiServiceUnavailable("Failed to update SMS blast");
  }

  return apiSuccess(data);
}

// DELETE /api/v1/sms/blasts/[id] — remove a blast from the campaigns list.
// Same three-way model as the email side (see email-blasts/[id]/route.ts):
//   • never-sent (no sms_messages rows)      -> HARD delete the row
//   • has send history                        -> SOFT hide (stamp deleted_at)
//   • in-flight (queued/sending/throttled)    -> 409, must /cancel first
// sms_messages.blast_id has ON DELETE CASCADE, so a hard delete takes its
// messages with it automatically.
const IN_FLIGHT_STATUSES = new Set(["queued", "sending", "throttled"]);

export async function DELETE(_request: NextRequest, { params }: RouteParams) {
  const requestId = crypto.randomUUID();
  const log = createRequestLogger({ requestId, method: "DELETE", path: "/api/v1/sms/blasts/[id]" });

  const guard = await requireSmsAccess();
  if (!guard.ok) return guard.response;
  const { db } = guard;
  const { id } = await params;

  const { data: existing, error: fetchError } = await db
    .from("sms_blasts")
    .select("id, status")
    .eq("id", id)
    .is("deleted_at", null)
    .maybeSingle();
  if (fetchError || !existing) return apiNotFound("SMS blast");
  const status = (existing as unknown as BlastRow).status;

  if (IN_FLIGHT_STATUSES.has(status)) {
    return apiConflict("This blast is in progress — cancel it first, then delete it");
  }

  const { count: messageCount, error: countError } = await db
    .from("sms_messages")
    .select("id", { count: "exact", head: true })
    .eq("blast_id", id);
  if (countError) {
    log.error({ err: countError }, "Failed to check sms blast messages before delete");
    return apiServiceUnavailable("Failed to delete SMS blast");
  }

  if ((messageCount ?? 0) === 0) {
    const { error: deleteError } = await db.from("sms_blasts").delete().eq("id", id);
    if (deleteError) {
      log.error({ err: deleteError }, "Failed to hard-delete sms blast");
      return apiServiceUnavailable("Failed to delete SMS blast");
    }
    return apiSuccess({ id, deleted: true });
  }

  const { data, error } = await db
    .from("sms_blasts")
    .update({ deleted_at: new Date().toISOString() })
    .eq("id", id)
    .select("*")
    .single();
  if (error) {
    log.error({ err: error }, "Failed to soft-delete sms blast");
    return apiServiceUnavailable("Failed to delete SMS blast");
  }

  return apiSuccess(data);
}
