import { renderTemplate } from "@/lib/email/render-template";
import { emitEvent } from "@/lib/api/audit";
import type { ScopedClient } from "@/lib/supabase/scoped";
import type { AuthContext } from "@/lib/api/auth";
import type { Lead } from "@/types/database";

export type LeadTemplateContext = Pick<
  Lead,
  "first_name" | "last_name" | "email" | "phone" | "city" | "country" | "custom_fields"
>;

export interface SequenceStepRow {
  id: string;
  tenant_id: string;
  sequence_id: string;
  step_order: number;
  delay_days: number;
  channel: string;
  draft_source: string;
  subject_template: string;
  body_template: string;
}

export interface SequenceEnrollmentRow {
  id: string;
  tenant_id: string;
  sequence_id: string;
  lead_id: string;
  assigned_to: string | null;
  status: "active" | "paused" | "completed" | "unenrolled";
  current_step_order: number;
  enrolled_by: string | null;
  started_at: string;
  completed_at: string | null;
}

export interface SequenceStepDraftRow {
  id: string;
  tenant_id: string;
  enrollment_id: string;
  step_id: string | null;
  lead_id: string;
  assigned_to: string | null;
  step_order: number;
  status: "pending" | "sent" | "skipped";
  due_at: string;
  draft_source: string;
  subject: string;
  body_html: string;
  edited: boolean;
  sent_at: string | null;
  sent_via: string | null;
  sent_activity_id: string | null;
}

export interface GeneratedDraft {
  subject: string;
  body_html: string;
  source: "template" | "ai";
}

export class EnrollmentConflictError extends Error {
  constructor() {
    super("Lead already has an active or paused sequence enrollment");
    this.name = "EnrollmentConflictError";
  }
}

/**
 * The draft SEAM. Stage 1 renders subject/body from the step's stored
 * templates. When step.draft_source === 'ai', swap in a call to the AI
 * drafter here (see src/app/(main)/api/v1/real-estate/comms/draft/route.ts
 * for the precedent shape; a shared src/lib/ai drafter is future work) —
 * everything downstream (drafts table, worklist, send-log) is unchanged.
 */
export function generateStepDraft(params: {
  step: Pick<SequenceStepRow, "draft_source" | "subject_template" | "body_template">;
  lead: LeadTemplateContext;
  tenantName: string;
}): GeneratedDraft {
  const { step, lead, tenantName } = params;
  const ctx = { lead: lead as unknown as Lead, tenant: { name: tenantName } };
  return {
    subject: renderTemplate(step.subject_template, ctx),
    body_html: renderTemplate(step.body_template, ctx),
    source: "template",
  };
}

async function loadLeadTemplateContext(
  db: ScopedClient,
  leadId: string
): Promise<LeadTemplateContext | null> {
  const { data } = await db
    .from("leads")
    .select("first_name, last_name, email, phone, city, country, custom_fields")
    .eq("id", leadId)
    .maybeSingle();
  return (data as LeadTemplateContext | null) ?? null;
}

async function loadTenantName(db: ScopedClient, tenantId: string): Promise<string> {
  const { data } = await db.fromGlobal("tenants").select("name").eq("id", tenantId).maybeSingle();
  return (data as { name: string } | null)?.name ?? "";
}

async function createDraftForStep(
  db: ScopedClient,
  auth: AuthContext,
  params: {
    enrollment: Pick<SequenceEnrollmentRow, "id" | "lead_id" | "assigned_to">;
    step: SequenceStepRow;
  }
): Promise<SequenceStepDraftRow | null> {
  const { enrollment, step } = params;
  const [lead, tenantName] = await Promise.all([
    loadLeadTemplateContext(db, enrollment.lead_id),
    loadTenantName(db, auth.tenantId),
  ]);
  if (!lead) return null;

  const drafted = generateStepDraft({ step, lead, tenantName });
  const dueAt = new Date(Date.now() + step.delay_days * 24 * 60 * 60 * 1000).toISOString();

  const { data, error } = await db
    .from("sequence_step_drafts")
    .insert({
      enrollment_id: enrollment.id,
      step_id: step.id,
      lead_id: enrollment.lead_id,
      assigned_to: enrollment.assigned_to,
      step_order: step.step_order,
      status: "pending",
      due_at: dueAt,
      draft_source: drafted.source,
      subject: drafted.subject,
      body_html: drafted.body_html,
    })
    .select("*")
    .single();

  if (error) return null;
  return data as unknown as SequenceStepDraftRow;
}

/**
 * Enrolls a lead into a sequence and creates its step-1 draft. Throws
 * EnrollmentConflictError if the lead already has a running (active/paused)
 * enrollment — enforced by the partial unique index (mig 176), not a
 * pre-check, so this stays race-free under concurrent enroll calls.
 */
export async function enrollLead(
  db: ScopedClient,
  auth: AuthContext,
  params: { sequenceId: string; leadId: string; assignedTo: string | null; enrolledBy: string }
): Promise<SequenceEnrollmentRow> {
  const { sequenceId, leadId, assignedTo, enrolledBy } = params;

  const { data: step1 } = await db
    .from("email_sequence_steps")
    .select("*")
    .eq("sequence_id", sequenceId)
    .eq("step_order", 1)
    .maybeSingle();
  if (!step1) throw new Error("Sequence has no step 1");

  const { data: enrollment, error } = await db
    .from("sequence_enrollments")
    .insert({
      sequence_id: sequenceId,
      lead_id: leadId,
      assigned_to: assignedTo,
      status: "active",
      current_step_order: 0,
      enrolled_by: enrolledBy,
    })
    .select("*")
    .single();

  if (error) {
    if (error.code === "23505") throw new EnrollmentConflictError();
    throw new Error(`Failed to create enrollment: ${error.message}`);
  }

  const enrollmentRow = enrollment as unknown as SequenceEnrollmentRow;

  await createDraftForStep(db, auth, {
    enrollment: enrollmentRow,
    step: step1 as unknown as SequenceStepRow,
  });

  await emitEvent({
    tenantId: auth.tenantId,
    type: "sequence.enrolled",
    entityType: "sequence_enrollment",
    entityId: enrollmentRow.id,
    payload: { sequence_id: sequenceId, lead_id: leadId },
  });

  return enrollmentRow;
}

/**
 * Creates the next step's draft, or completes the enrollment when there is
 * no next step. Called after a draft is sent or skipped.
 */
export async function advanceEnrollment(
  db: ScopedClient,
  auth: AuthContext,
  enrollment: Pick<SequenceEnrollmentRow, "id" | "sequence_id" | "lead_id" | "assigned_to">,
  fromStepOrder: number
): Promise<void> {
  const { data: nextStep } = await db
    .from("email_sequence_steps")
    .select("*")
    .eq("sequence_id", enrollment.sequence_id)
    .gt("step_order", fromStepOrder)
    .order("step_order", { ascending: true })
    .limit(1)
    .maybeSingle();

  if (nextStep) {
    await createDraftForStep(db, auth, { enrollment, step: nextStep as unknown as SequenceStepRow });
    return;
  }

  await db
    .from("sequence_enrollments")
    .update({ status: "completed", completed_at: new Date().toISOString() })
    .eq("id", enrollment.id);

  await emitEvent({
    tenantId: auth.tenantId,
    type: "sequence.completed",
    entityType: "sequence_enrollment",
    entityId: enrollment.id,
    payload: { sequence_id: enrollment.sequence_id, lead_id: enrollment.lead_id },
  });
}

/**
 * Marks a draft sent (manual-copy model only — the human sent it from
 * their own inbox), logs it to the lead timeline, and advances the
 * enrollment. Does NOT touch emails/automation_email_log or emit
 * email.sent — this is a log-only action, never a real send.
 */
export async function markDraftSent(
  db: ScopedClient,
  auth: AuthContext,
  draftId: string,
  opts: { edited: boolean }
): Promise<{ activityId: string } | null> {
  const { data: draft } = await db
    .from("sequence_step_drafts")
    .select("*")
    .eq("id", draftId)
    .maybeSingle();
  if (!draft) return null;
  const draftRow = draft as unknown as SequenceStepDraftRow;
  if (draftRow.status !== "pending") return null;

  const { data: enrollment } = await db
    .from("sequence_enrollments")
    .select("*")
    .eq("id", draftRow.enrollment_id)
    .maybeSingle();
  if (!enrollment) return null;
  const enrollmentRow = enrollment as unknown as SequenceEnrollmentRow;

  const { data: activity, error: activityError } = await db
    .from("lead_activities")
    .insert({
      lead_id: draftRow.lead_id,
      user_id: auth.userId,
      activity_type: "email",
      subject: draftRow.subject,
      description: `Sequence step ${draftRow.step_order} sent`,
      email_subject: draftRow.subject,
      email_body: draftRow.body_html,
      completed_at: new Date().toISOString(),
      metadata: {
        source: "sequence",
        sequence_id: enrollmentRow.sequence_id,
        enrollment_id: enrollmentRow.id,
        step_order: draftRow.step_order,
      },
    })
    .select("id")
    .single();

  if (activityError || !activity) return null;
  const activityId = (activity as { id: string }).id;

  await db
    .from("sequence_step_drafts")
    .update({
      status: "sent",
      sent_at: new Date().toISOString(),
      sent_via: "manual_copy",
      edited: opts.edited,
      sent_activity_id: activityId,
    })
    .eq("id", draftId);

  await db
    .from("sequence_enrollments")
    .update({ current_step_order: draftRow.step_order })
    .eq("id", enrollmentRow.id);

  await emitEvent({
    tenantId: auth.tenantId,
    type: "sequence.step_sent",
    entityType: "sequence_step_draft",
    entityId: draftId,
    payload: {
      sequence_id: enrollmentRow.sequence_id,
      lead_id: draftRow.lead_id,
      step_order: draftRow.step_order,
    },
  });

  await advanceEnrollment(db, auth, enrollmentRow, draftRow.step_order);

  return { activityId };
}

export async function skipDraft(db: ScopedClient, auth: AuthContext, draftId: string): Promise<boolean> {
  const { data: draft } = await db
    .from("sequence_step_drafts")
    .select("*")
    .eq("id", draftId)
    .maybeSingle();
  if (!draft) return false;
  const draftRow = draft as unknown as SequenceStepDraftRow;
  if (draftRow.status !== "pending") return false;

  const { data: enrollment } = await db
    .from("sequence_enrollments")
    .select("*")
    .eq("id", draftRow.enrollment_id)
    .maybeSingle();
  if (!enrollment) return false;
  const enrollmentRow = enrollment as unknown as SequenceEnrollmentRow;

  await db.from("sequence_step_drafts").update({ status: "skipped" }).eq("id", draftId);

  await db
    .from("sequence_enrollments")
    .update({ current_step_order: draftRow.step_order })
    .eq("id", enrollmentRow.id);

  await advanceEnrollment(db, auth, enrollmentRow, draftRow.step_order);

  return true;
}

/** Unenrolls a lead and skips any drafts still pending (interrupts the cadence). */
export async function unenrollLead(db: ScopedClient, enrollmentId: string): Promise<void> {
  await db.from("sequence_enrollments").update({ status: "unenrolled" }).eq("id", enrollmentId);

  await db
    .from("sequence_step_drafts")
    .update({ status: "skipped" })
    .eq("enrollment_id", enrollmentId)
    .eq("status", "pending");
}
