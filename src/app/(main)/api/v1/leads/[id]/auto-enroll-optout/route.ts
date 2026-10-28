import { NextRequest } from "next/server";
import { authenticateRequest } from "@/lib/api/auth";
import { apiSuccess, apiUnauthorized, apiForbidden, apiNotFound, apiError, apiValidationError } from "@/lib/api/response";
import { getFeatureAccess } from "@/industries/_loader";
import { FEATURES } from "@/industries/_registry";
import { scopedClient } from "@/lib/supabase/scoped";
import { createRequestLogger } from "@/lib/logger";
import { loadVisibleLead } from "@/industries/_shared/features/outreach/lib/lead-visibility";
import { toOptOuts } from "@/industries/_shared/features/outreach/lib/lead-subscriptions";

// /api/v1/leads/[id]/auto-enroll-optout — "don't auto-enroll this lead" (migration 277), per channel.
//   PUT    { channels: ["email" | "sms", ...] }  → switches stage auto-enroll OFF for this lead on those channels
//   DELETE { channels: [...] }                    → switches it back ON
// It only stops stage RULES from enrolling the lead; people can still enroll them by hand. Anyone who can open the lead may
// change it (a counselor stopping a sequence on their own lead should not need an admin).

interface Props {
  params: Promise<{ id: string }>;
}

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const CHANNELS = ["email", "sms"] as const;
type Channel = (typeof CHANNELS)[number];

function parseChannels(raw: unknown): { ok: true; channels: Channel[] } | { ok: false } {
  if (!Array.isArray(raw) || raw.length === 0) return { ok: false };
  const channels = [...new Set(raw)];
  if (!channels.every((c): c is Channel => (CHANNELS as readonly unknown[]).includes(c))) return { ok: false };
  return { ok: true, channels };
}

async function handle(request: NextRequest, { params }: Props, mode: "off" | "on") {
  const { id } = await params;
  const log = createRequestLogger({
    requestId: crypto.randomUUID(),
    method: mode === "off" ? "PUT" : "DELETE",
    path: `/api/v1/leads/${id}/auto-enroll-optout`,
  });

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
  const parsed = parseChannels(body.channels);
  if (!parsed.ok) return apiValidationError({ channels: ['Must be a non-empty list of "email" and/or "sms"'] });

  const db = await scopedClient(auth);
  if (!(await loadVisibleLead(db, auth, id))) return apiNotFound("Lead");

  if (mode === "off") {
    const { error } = await db
      .from("lead_auto_enroll_optouts")
      .upsert(
        parsed.channels.map((channel) => ({ lead_id: id, channel, created_by: auth.userId })),
        { onConflict: "tenant_id,lead_id,channel", ignoreDuplicates: true }
      );
    if (error) {
      log.error({ err: error, leadId: id }, "Failed to switch auto-enroll off for the lead");
      return apiError("DB_ERROR", "Failed to update auto-enroll for this lead", 500);
    }
  } else {
    const { error } = await db.from("lead_auto_enroll_optouts").delete().eq("lead_id", id).in("channel", parsed.channels);
    if (error) {
      log.error({ err: error, leadId: id }, "Failed to switch auto-enroll back on for the lead");
      return apiError("DB_ERROR", "Failed to update auto-enroll for this lead", 500);
    }
  }

  const { data, error } = await db.from("lead_auto_enroll_optouts").select("channel").eq("lead_id", id);
  if (error) return apiError("DB_ERROR", "Failed to read the lead's auto-enroll setting", 500);
  return apiSuccess({ autoEnrollOptOuts: toOptOuts((data ?? []) as unknown as { channel: string }[]) });
}

export async function PUT(request: NextRequest, ctx: Props) {
  return handle(request, ctx, "off");
}

export async function DELETE(request: NextRequest, ctx: Props) {
  return handle(request, ctx, "on");
}
