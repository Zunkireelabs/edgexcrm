import { NextRequest } from "next/server";
import { authenticateRequest, requireAdmin } from "@/lib/api/auth";
import { apiSuccess, apiUnauthorized, apiForbidden, apiNotFound, apiError, apiValidationError } from "@/lib/api/response";
import { createRequestLogger } from "@/lib/logger";
import { scopedClient } from "@/lib/supabase/scoped";
import { getFeatureAccess } from "@/industries/_loader";
import { FEATURES } from "@/industries/_registry";
import { isSmsEnabledForTenant } from "@/lib/sms/flag";
import { channelOf } from "@/industries/_shared/features/outreach/lib/channel";
import {
  enrollExistingLeadsInStages,
  loadSequenceStages,
  parseStageIds,
  setSequenceStages,
} from "@/industries/_shared/features/outreach/lib/stage-rules";

// /api/v1/outreach/sequences/[id]/stage-triggers — the stages this sequence auto-enrolls from (migration 277).
//   GET                  → { stages }
//   PUT  { list_ids, replace?, enroll_existing? }   → makes the linked stages exactly list_ids (empty = auto-enroll off).
//        409 STAGE_TAKEN (with details.taken) when another sequence already holds a stage on this channel, unless replace:true.
// Reading is open to anyone who can see sequences; changing is admin-only, like editing the sequence itself.

type Props = { params: Promise<{ id: string }> };

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(_request: NextRequest, { params }: Props) {
  const { id } = await params;
  const auth = await authenticateRequest();
  if (!auth) return apiUnauthorized();
  if (!getFeatureAccess(auth.industryId, FEATURES.OUTREACH)) return apiForbidden();
  if (!UUID_REGEX.test(id)) return apiValidationError({ id: ["Invalid sequence id"] });

  const db = await scopedClient(auth);
  const { data: sequence } = await db.from("email_sequences").select("id").eq("id", id).maybeSingle();
  if (!sequence) return apiNotFound("Sequence");

  try {
    return apiSuccess({ stages: await loadSequenceStages(db, id) });
  } catch {
    return apiError("DB_ERROR", "Failed to load the sequence's stages", 500);
  }
}

export async function PUT(request: NextRequest, { params }: Props) {
  const { id } = await params;
  const log = createRequestLogger({ requestId: crypto.randomUUID(), method: "PUT", path: `/api/v1/outreach/sequences/${id}/stage-triggers` });

  const auth = await authenticateRequest();
  if (!auth) return apiUnauthorized();
  if (!getFeatureAccess(auth.industryId, FEATURES.OUTREACH)) return apiForbidden();
  if (!requireAdmin(auth)) return apiForbidden();
  if (!UUID_REGEX.test(id)) return apiValidationError({ id: ["Invalid sequence id"] });

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return apiError("INVALID_JSON", "Request body must be valid JSON", 400);
  }
  const parsed = parseStageIds(body.list_ids);
  if (!parsed.ok) return apiValidationError({ list_ids: [parsed.error] });

  const db = await scopedClient(auth);
  const { data: sequence } = await db.from("email_sequences").select("id, status, channel").eq("id", id).maybeSingle();
  const seq = sequence as unknown as { id: string; status: string; channel: string | null } | null;
  if (!seq || seq.status !== "active") return apiNotFound("Sequence");
  const channel = channelOf(seq);

  // A text sequence that enrolls people on its own spends shared SMS credits: same standing as a bulk SMS enroll.
  if (channel === "sms" && parsed.listIds.length > 0) {
    if (!(await isSmsEnabledForTenant(auth.tenantId))) return apiForbidden("SMS isn't turned on for your account.");
    if (!auth.permissions.canSendSms) return apiForbidden("You need SMS permission to auto-enroll leads in an SMS sequence.");
  }

  try {
    const result = await setSequenceStages(db, {
      sequenceId: id,
      channel,
      listIds: parsed.listIds,
      createdBy: auth.userId,
      replace: body.replace === true,
    });
    if (!result.ok) {
      if (result.reason === "invalid_stage") {
        return apiValidationError({ list_ids: ["One or more stages were not found (archive stages can't be used)."] });
      }
      return apiError(
        "STAGE_TAKEN",
        "Another sequence already auto-enrolls from one of these stages.",
        409,
        { taken: result.taken }
      );
    }

    let enrolledExisting: { leads_queued: number; capped: boolean } | null = null;
    if (body.enroll_existing === true && parsed.listIds.length > 0) {
      const existing = await enrollExistingLeadsInStages(db, auth.tenantId, {
        sequenceId: id,
        channel,
        listIds: parsed.listIds,
        createdBy: auth.userId,
      });
      enrolledExisting = { leads_queued: existing.leadsQueued, capped: existing.capped };
    }

    log.info({ sequenceId: id, added: result.added.length, removed: result.removed.length, replaced: result.replaced.length }, "Stage auto-enroll rule saved");
    const stages = await loadSequenceStages(db, id);
    return apiSuccess({ stages, replaced: result.replaced, enrolled_existing: enrolledExisting });
  } catch (err) {
    log.error({ err, sequenceId: id }, "Failed to save the stage auto-enroll rule");
    return apiError("DB_ERROR", "Failed to save the auto-enroll rule", 500);
  }
}
