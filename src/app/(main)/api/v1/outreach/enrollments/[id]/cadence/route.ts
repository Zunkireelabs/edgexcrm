import { NextRequest } from "next/server";
import { authenticateRequest } from "@/lib/api/auth";
import { shouldRestrictToSelf } from "@/lib/api/permissions";
import { apiSuccess, apiUnauthorized, apiForbidden, apiNotFound } from "@/lib/api/response";
import { createRequestLogger } from "@/lib/logger";
import { scopedClient } from "@/lib/supabase/scoped";
import { getFeatureAccess } from "@/industries/_loader";
import { FEATURES } from "@/industries/_registry";
import { renderTemplate } from "@/lib/email/render-template";
import type { Lead } from "@/types/database";

type Props = { params: Promise<{ id: string }> };

const DAY_MS = 24 * 60 * 60 * 1000;

interface EnrollmentRow {
  id: string;
  sequence_id: string;
  lead_id: string;
  assigned_to: string | null;
  status: "active" | "paused" | "completed" | "unenrolled";
  current_step_order: number;
}

interface SequenceStepRow {
  step_order: number;
  delay_days: number;
  subject_template: string;
  body_template: string;
}

interface DraftRow {
  id: string;
  step_order: number;
  status: "pending" | "sent" | "skipped";
  due_at: string;
  subject: string;
  body_html: string;
  sent_at: string | null;
  sent_activity_id: string | null;
}

type LeadTemplateContext = Pick<
  Lead,
  "first_name" | "last_name" | "email" | "phone" | "city" | "country" | "custom_fields"
>;

// GET /api/v1/outreach/enrollments/[id]/cadence — the lead's whole cadence:
// sent + due-now + scheduled steps from sequence_step_drafts, plus
// projected (not-yet-materialized) future steps estimated from delay_days.
export async function GET(_request: NextRequest, { params }: Props) {
  const { id } = await params;
  const requestId = crypto.randomUUID();
  const log = createRequestLogger({
    requestId,
    method: "GET",
    path: "/api/v1/outreach/enrollments/[id]/cadence",
  });

  const auth = await authenticateRequest();
  if (!auth) return apiUnauthorized();
  if (!getFeatureAccess(auth.industryId, FEATURES.OUTREACH)) return apiForbidden();

  const db = await scopedClient(auth);

  const { data: enrollment } = await db
    .from("sequence_enrollments")
    .select("id, sequence_id, lead_id, assigned_to, status, current_step_order")
    .eq("id", id)
    .maybeSingle();
  if (!enrollment) return apiNotFound("Enrollment");
  const enrollmentRow = enrollment as unknown as EnrollmentRow;

  // Owner/admin see any enrollment; everyone else (incl. counselors via
  // shouldRestrictToSelf) may only read their own — same convention as the
  // drafts/enrollments list routes.
  const isAdminTier = auth.role === "owner" || auth.role === "admin";
  if ((!isAdminTier || shouldRestrictToSelf(auth.permissions)) && enrollmentRow.assigned_to !== auth.userId) {
    return apiNotFound("Enrollment");
  }

  const [{ data: sequence }, { data: steps }, { data: drafts }, { data: lead }, { data: tenant }] = await Promise.all([
    db.from("email_sequences").select("id, name").eq("id", enrollmentRow.sequence_id).maybeSingle(),
    db
      .from("email_sequence_steps")
      .select("step_order, delay_days, subject_template, body_template")
      .eq("sequence_id", enrollmentRow.sequence_id)
      .order("step_order", { ascending: true }),
    db
      .from("sequence_step_drafts")
      .select("id, step_order, status, due_at, subject, body_html, sent_at, sent_activity_id")
      .eq("enrollment_id", id)
      .order("step_order", { ascending: true }),
    db
      .from("leads")
      .select("first_name, last_name, email, phone, city, country, custom_fields")
      .eq("id", enrollmentRow.lead_id)
      .maybeSingle(),
    db.fromGlobal("tenants").select("name").eq("id", auth.tenantId).maybeSingle(),
  ]);

  if (!sequence) {
    log.error({ enrollmentId: id, sequenceId: enrollmentRow.sequence_id }, "Enrollment references a missing sequence");
    return apiNotFound("Sequence");
  }
  const sequenceRow = sequence as unknown as { id: string; name: string };
  const stepRows = (steps ?? []) as unknown as SequenceStepRow[];
  const draftRows = (drafts ?? []) as unknown as DraftRow[];
  const leadCtx: LeadTemplateContext =
    (lead as unknown as LeadTemplateContext | null) ??
    { first_name: null, last_name: null, email: null, phone: null, city: null, country: null, custom_fields: {} };
  const tenantName = (tenant as { name: string } | null)?.name ?? "";

  const draftByStep = new Map(draftRows.map((d) => [d.step_order, d]));

  // Anchor for projecting future (not-yet-materialized) steps: the current
  // pending draft's due_at, else the most recently sent draft's sent_at,
  // else now. These estimates are recomputed on every request, never stored.
  const pendingDraft = draftRows.find((d) => d.status === "pending");
  const lastSentDraft = [...draftRows].filter((d) => d.status === "sent").sort((a, b) => b.step_order - a.step_order)[0];
  let projectedMs = pendingDraft
    ? new Date(pendingDraft.due_at).getTime()
    : lastSentDraft?.sent_at
      ? new Date(lastSentDraft.sent_at).getTime()
      : Date.now();

  const renderCtx = { lead: leadCtx as unknown as Lead, tenant: { name: tenantName } };

  const timeline = stepRows.map((step) => {
    const draft = draftByStep.get(step.step_order);
    if (draft) {
      return {
        step_order: step.step_order,
        state: draft.status,
        subject: draft.subject,
        due_at: draft.due_at,
        sent_at: draft.sent_at,
        draft_id: draft.id,
        sent_activity_id: draft.sent_activity_id,
        // Only pending drafts need body_html — it's what lets the "due now"
        // row reuse DraftReviewPanel (draft-review-panel.tsx) unforked.
        body_html: draft.status === "pending" ? draft.body_html : undefined,
      };
    }

    projectedMs += step.delay_days * DAY_MS;
    return {
      step_order: step.step_order,
      state: "projected" as const,
      subject: renderTemplate(step.subject_template, renderCtx),
      projected_due_at: new Date(projectedMs).toISOString(),
    };
  });

  return apiSuccess({
    enrollment: {
      id: enrollmentRow.id,
      status: enrollmentRow.status,
      current_step_order: enrollmentRow.current_step_order,
      assigned_to: enrollmentRow.assigned_to,
    },
    sequence: { id: sequenceRow.id, name: sequenceRow.name, total_steps: stepRows.length },
    timeline,
  });
}
