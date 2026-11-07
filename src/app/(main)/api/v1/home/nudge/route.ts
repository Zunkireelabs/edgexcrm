import { NextRequest } from "next/server";
import { authenticateRequest } from "@/lib/api/auth";
import { apiError, apiForbidden, apiNotFound, apiSuccess, apiUnauthorized, apiValidationError } from "@/lib/api/response";
import { leadQueryScope } from "@/lib/api/permissions";
import { scopedClient } from "@/lib/supabase/scoped";
import { createNotification, NotificationTypes } from "@/lib/notifications";
import { getFeatureAccess } from "@/industries/_loader";
import { FEATURES } from "@/industries/_registry";
import { canNudge, nudgeMessage } from "@/industries/education-consultancy/features/home/lib/nudge";
import { localDate } from "@/industries/education-consultancy/features/home/lib/time";
import { untouchedHeldOfPersonHref } from "@/industries/education-consultancy/features/pulse/lib/leads-links";
import { untouchedHeldCutoff } from "@/industries/education-consultancy/features/pulse/lib/untouched";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_LEADS = 200;

// POST /api/v1/home/nudge  { to_user_id }
// "Nudge <name>": tells that person which of their leads have had no touch for 3+ days (Pulse's own "untouched held"
// rule, so the number matches what Pulse shows) and records the nudge. The next day the manager's Home brings the item
// back if those leads are still untouched. At most one nudge per manager and person per day.
export async function POST(request: NextRequest) {
  const auth = await authenticateRequest();
  if (!auth) return apiUnauthorized();
  if (!getFeatureAccess(auth.industryId, FEATURES.EDU_HOME)) return apiForbidden();

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return apiValidationError({ body: ["Invalid JSON body"] });
  }
  const to = body.to_user_id;
  if (typeof to !== "string" || !UUID_RE.test(to)) return apiValidationError({ to_user_id: ["A valid user id is required"] });

  const scope = leadQueryScope(auth.permissions, auth.userId, auth.branchId);
  if (!canNudge({ restrictToSelf: scope.restrictToSelf, selfId: auth.userId, targetId: to, branchPinned: scope.branchId !== null && auth.permissions.leadScope === "team", branchMemberIds: auth.branchMemberIds })) {
    return apiForbidden();
  }

  const db = await scopedClient(auth);
  const { data: member } = await db.from("tenant_users").select("user_id").eq("user_id", to).is("suspended_at", null).maybeSingle();
  if (!member) return apiNotFound("Team member");

  const { data: tenantRow } = await db.raw().from("tenants").select("timezone").eq("id", auth.tenantId).single();
  const tz = (tenantRow as unknown as { timezone: string | null } | null)?.timezone ?? "Asia/Kathmandu";
  const now = new Date();

  // Already nudged today (tenant-local)? Idempotent: report it, send nothing twice.
  const { data: open } = await db
    .from("lead_nudges")
    .select("id, created_at, lead_ids")
    .eq("from_user_id", auth.userId)
    .eq("to_user_id", to)
    .is("resolved_at", null)
    .order("created_at", { ascending: false })
    .limit(1);
  const last = ((open ?? []) as unknown as Array<{ id: string; created_at: string; lead_ids: string[] }>)[0];
  if (last && localDate(new Date(last.created_at), tz) === localDate(now, tz)) {
    return apiSuccess({ nudged: true, already: true, lead_count: last.lead_ids.length });
  }

  const { data: lists } = await db.from("lead_lists").select("id, is_archive");
  const active = ((lists ?? []) as unknown as Array<{ id: string; is_archive: boolean }>).filter((l) => !l.is_archive).map((l) => l.id);
  const cutoff = untouchedHeldCutoff(now);
  const { data: leads } = active.length
    ? await db
        .from("leads")
        .select("id")
        .eq("assigned_to", to)
        .is("deleted_at", null)
        .in("list_id", active)
        .or(`last_touched_at.is.null,last_touched_at.lt.${cutoff}`)
        .lt("stage_changed_at", cutoff)
        .order("created_at", { ascending: true })
        .limit(MAX_LEADS)
    : { data: [] };
  const leadIds = ((leads ?? []) as unknown as Array<{ id: string }>).map((l) => l.id);
  if (leadIds.length === 0) return apiError("NOTHING_TO_NUDGE", "No untouched leads to nudge about", 422);

  const { error } = await db.from("lead_nudges").insert({ from_user_id: auth.userId, to_user_id: to, lead_ids: leadIds });
  if (error) return apiError("DB_ERROR", "Failed to record the nudge", 500);

  const name = (auth.email ?? "Your manager").split("@")[0];
  const msg = nudgeMessage(name, leadIds.length);
  await createNotification({
    tenantId: auth.tenantId,
    userId: to,
    type: NotificationTypes.LEAD_NUDGE,
    title: msg.title,
    message: msg.message,
    link: untouchedHeldOfPersonHref(to),
  });
  return apiSuccess({ nudged: true, already: false, lead_count: leadIds.length }, 201);
}
