import { NextRequest } from "next/server";
import { authenticateRequest, requireLeadBranchAccess } from "@/lib/api/auth";
import { apiSuccess, apiUnauthorized, apiForbidden, apiNotFound, apiValidationError, apiServiceUnavailable } from "@/lib/api/response";
import { getFeatureAccess } from "@/industries/_loader";
import { FEATURES } from "@/industries/_registry";
import { scopedClient } from "@/lib/supabase/scoped";
import { createRequestLogger } from "@/lib/logger";
import { shouldRestrictToSelf } from "@/lib/api/permissions";
import { getLeadMembership } from "@/lib/leads/branch-membership";
import { isLeadCollaborator } from "@/lib/leads/collaborators";
import {
  CAMPAIGN_LIMIT,
  toCampaignRows,
  toQueuedRows,
  toSequenceRows,
  type LeadSubscriptions,
  type RawBlast,
  type RawEnrollment,
  type RawMessage,
  type RawQueueRow,
} from "@/industries/_shared/features/outreach/lib/lead-subscriptions";

// GET /api/v1/leads/[id]/subscriptions — everything this lead is (or was) "subscribed" to, for the lead page's Subscribed tab:
//   - outreach sequences, email and SMS: running/paused now, queued to start next, and past ones with why they ended;
//   - campaigns (one-off email / SMS blasts) this lead was sent, newest first.
//
// Read-only. Visibility follows the LEAD (same rule as the lead page and the student-record route): an own-scope counselor sees their
// own leads and ones they collaborate on, a branch-scoped user their branch. This is deliberately NOT the outreach list's
// "enrollments assigned to me" rule, which showed a branch manager or a collaborator an empty list for a lead they can open.

interface Props {
  params: Promise<{ id: string }>;
}

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function GET(_request: NextRequest, { params }: Props) {
  const { id } = await params;
  const log = createRequestLogger({ requestId: crypto.randomUUID(), method: "GET", path: `/api/v1/leads/${id}/subscriptions` });

  const auth = await authenticateRequest();
  if (!auth) return apiUnauthorized();
  if (!getFeatureAccess(auth.industryId, FEATURES.OUTREACH)) return apiForbidden();
  if (!UUID_REGEX.test(id)) return apiValidationError({ id: ["Invalid lead id"] });

  const db = await scopedClient(auth);
  const { data: lead } = await db.from("leads").select("id, assigned_to, branch_id").eq("id", id).is("deleted_at", null).maybeSingle();
  if (!lead) return apiNotFound("Lead");
  const leadRow = lead as unknown as { id: string; assigned_to: string | null; branch_id: string | null };

  const membership = await getLeadMembership(db.raw(), auth.tenantId, id);
  const restrictedAndUnassigned =
    shouldRestrictToSelf(auth.permissions) &&
    !(membership.some((m) => m.assigned_to === auth.userId) || leadRow.assigned_to === auth.userId);
  if (restrictedAndUnassigned || !requireLeadBranchAccess(auth, leadRow, membership)) {
    if (!(await isLeadCollaborator(db.raw(), auth.tenantId, id, auth.userId))) return apiNotFound("Lead");
  }

  const withEmailCampaigns = getFeatureAccess(auth.industryId, FEATURES.EMAIL_CAMPAIGNS);
  const withSmsCampaigns = getFeatureAccess(auth.industryId, FEATURES.SMS);
  const none = Promise.resolve({ data: [] as unknown[], error: null });

  const [enrollments, queue, emails, texts] = await Promise.all([
    db
      .from("sequence_enrollments")
      .select("id, sequence_id, channel, status, current_step_order, assigned_to, started_at, completed_at, stopped_at, stop_reason, email_sequences(name)")
      .eq("lead_id", id)
      .order("started_at", { ascending: false }),
    db
      .from("sequence_enrollment_queue")
      .select("id, sequence_id, channel, created_at, email_sequences(name)")
      .eq("lead_id", id)
      .eq("status", "waiting")
      .order("created_at", { ascending: true }),
    withEmailCampaigns
      ? db
          .from("email_messages")
          .select("id, source_id, subject, status, sent_at, created_at")
          .eq("lead_id", id)
          .eq("source", "blast")
          .order("created_at", { ascending: false })
          .limit(CAMPAIGN_LIMIT)
      : none,
    withSmsCampaigns
      ? db
          .from("sms_messages")
          .select("id, blast_id, body, status, sent_at, created_at")
          .eq("lead_id", id)
          .eq("source", "blast")
          .order("created_at", { ascending: false })
          .limit(CAMPAIGN_LIMIT)
      : none,
  ]);
  if (enrollments.error || queue.error || emails.error || texts.error) {
    log.error({ leadId: id }, "Failed to load the lead's subscriptions");
    return apiServiceUnavailable("Failed to load subscriptions");
  }

  const emailRows = (emails.data ?? []) as unknown as RawMessage[];
  const smsRows = (texts.data ?? []) as unknown as RawMessage[];
  // Campaign names, one query per kind (a lead receives a handful of campaigns, not thousands).
  const emailBlastIds = [...new Set(emailRows.map((m) => m.source_id).filter((v): v is string => !!v))];
  const smsBlastIds = [...new Set(smsRows.map((m) => m.blast_id).filter((v): v is string => !!v))];
  const [emailBlasts, smsBlasts] = await Promise.all([
    emailBlastIds.length > 0 ? db.from("email_blasts").select("id, name").in("id", emailBlastIds) : none,
    smsBlastIds.length > 0 ? db.from("sms_blasts").select("id, name").in("id", smsBlastIds) : none,
  ]);
  // Names are a nicety: on a failed lookup the rows still show (with a generic name), but say so in the logs.
  if (emailBlasts.error || smsBlasts.error) {
    log.warn({ leadId: id, emailError: emailBlasts.error?.message, smsError: smsBlasts.error?.message }, "Campaign name lookup failed");
  }

  const body: LeadSubscriptions = {
    sequences: toSequenceRows((enrollments.data ?? []) as unknown as RawEnrollment[]),
    queued: toQueuedRows((queue.data ?? []) as unknown as RawQueueRow[]),
    campaigns: toCampaignRows(
      emailRows,
      smsRows,
      (emailBlasts.data ?? []) as unknown as RawBlast[],
      (smsBlasts.data ?? []) as unknown as RawBlast[],
    ),
  };
  return apiSuccess(body);
}
