import { NextRequest } from "next/server";
import { authenticateRequest, requireLeadBranchAccess } from "@/lib/api/auth";
import { createServiceClient } from "@/lib/supabase/server";
import { scopedClient } from "@/lib/supabase/scoped";
import { resolveUserNames } from "@/lib/supabase/queries";
import { getLeadMembership } from "@/lib/leads/branch-membership";
import { isLeadCollaborator } from "@/lib/leads/collaborators";
import { shouldRestrictToSelf } from "@/lib/api/permissions";
import { checkApplicationsReadiness, applicationsGateApplies } from "@/lib/leads/applications-readiness";
import { apiSuccess, apiUnauthorized, apiForbidden, apiNotFound, apiError } from "@/lib/api/response";
import { humanizeIntakeValue } from "@/components/dashboard/lead/activities/lead-activity-labels";
import { flattenReadiness } from "@/industries/education-consultancy/features/record-preview/lib/readiness";
import { creationHow, ensureCreationEvent, isCreationAudit } from "@/industries/education-consultancy/features/record-preview/lib/creation-event";
import { pickIntake } from "@/industries/education-consultancy/features/record-preview/lib/study-plan";
import type { PreviewActivity } from "@/industries/education-consultancy/features/record-preview/use-preview-data";
import { describeAuditEvent } from "@/components/dashboard/lead/activities/describe-audit-event";

interface AuditRow {
  id: string;
  action: string;
  entity_type: string;
  changes: Record<string, { old: unknown; new: unknown }> | null;
  user_id: string | null;
  created_at: string;
}

const SHOWN_AUDIT_KINDS = new Set(["stage", "assigned", "unassigned", "graduated", "list", "submission", "consent", "created"]);

interface RouteContext {
  params: Promise<{ id: string }>;
}

type Row = Record<string, unknown>;

// GET /api/v1/leads/:id/preview[?feed=all]
//
// Read-only: everything the education record-preview panel needs that the table row doesn't already carry.
// Gate: `applicationsGateApplies` (the application-tracking feature — education only), same as applications-readiness.
export async function GET(request: NextRequest, context: RouteContext) {
  const { id } = await context.params;

  const auth = await authenticateRequest();
  if (!auth) return apiUnauthorized();
  if (!applicationsGateApplies(auth.industryId)) return apiForbidden();

  const db = await scopedClient(auth);
  const { data: lead } = await db
    .from("leads")
    .select("id, assigned_to, branch_id, form_config_id, intake_source, intake_medium, intake_campaign, city, created_at, pre_app_fee_status, intake_term, custom_fields")
    .eq("id", id)
    .is("deleted_at", null)
    .maybeSingle();
  if (!lead) return apiNotFound("Lead");
  const leadRow = lead as unknown as Row & { id: string; assigned_to: string | null; branch_id: string | null };

  // Visibility — the exact block from applications-readiness/route.ts (own-scope, branch access, collaborator fallback → 404).
  const raw = await createServiceClient();
  const membership = await getLeadMembership(raw, auth.tenantId, id);
  const isRestrictedAndUnassigned =
    shouldRestrictToSelf(auth.permissions) &&
    !(
      membership.some((m: { assigned_to: string | null }) => m.assigned_to === auth.userId) ||
      leadRow.assigned_to === auth.userId
    );
  if (isRestrictedAndUnassigned) {
    if (!(await isLeadCollaborator(raw, auth.tenantId, id, auth.userId))) return apiNotFound("Lead");
  } else if (!requireLeadBranchAccess(auth, leadRow, membership)) {
    if (!(await isLeadCollaborator(raw, auth.tenantId, id, auth.userId))) return apiNotFound("Lead");
  }

  const feedAll = request.nextUrl.searchParams.get("feed") === "all";
  const feedLimit = feedAll ? 50 : 3;

  // lead_notes has no tenant_id column (scopedClient would inject one): it is keyed by lead_id, and the lead was
  // verified in this tenant above, so fromGlobal is the right door.
  const [openTasks, notes, latestNote, acts, audits, firstAudit, apps, readiness, tpl, consent, branch, form] = await Promise.all([
    db.from("tasks").select("id, title, due_date, assignee_id", { count: "exact" }).eq("lead_id", id).neq("status", "done")
      .order("due_date", { ascending: true, nullsFirst: false }).limit(3),
    db.fromGlobal("lead_notes").select("id", { count: "exact", head: true }).eq("lead_id", id),
    db.fromGlobal("lead_notes").select("id, content, user_id, user_email, created_at").eq("lead_id", id).order("created_at", { ascending: false }).limit(feedLimit),
    db.from("lead_activities").select("id, user_id, activity_type, subject, description, email_subject, created_at").eq("lead_id", id).order("created_at", { ascending: false }).limit(feedLimit),
    db.from("audit_logs").select("id, action, entity_type, changes, user_id, created_at").eq("entity_id", id).eq("entity_type", "lead").order("created_at", { ascending: false }).limit(feedLimit),
    db.from("audit_logs").select("id, action, entity_type, changes, user_id, created_at").eq("entity_id", id).eq("entity_type", "lead").order("created_at", { ascending: true }).limit(1),
    db.from("applications").select("id, university_name, program_name, intake_term, status, stage_id, stage_changed_at", { count: "exact" }).eq("lead_id", id).is("deleted_at", null).order("created_at", { ascending: false }),
    checkApplicationsReadiness(raw, auth.tenantId, id),
    db.from("consent_templates").select("is_active").maybeSingle(),
    db.from("lead_consents").select("signed_at").eq("lead_id", id).eq("status", "signed").is("deleted_at", null).order("signed_at", { ascending: false }).limit(1).maybeSingle(),
    leadRow.branch_id ? db.from("branches").select("name").eq("id", leadRow.branch_id).maybeSingle() : Promise.resolve({ data: null }),
    leadRow.form_config_id ? db.from("form_configs").select("name").eq("id", leadRow.form_config_id).maybeSingle() : Promise.resolve({ data: null }),
  ]);
  if (openTasks.error || latestNote.error || acts.error) return apiError("DB_ERROR", "Failed to load preview", 500, { tasks: openTasks.error?.message, notes: latestNote.error?.message, acts: acts.error?.message });

  const taskRows = (openTasks.data ?? []) as unknown as Array<{ id: string; title: string; due_date: string | null; assignee_id: string | null }>;
  const noteRows = (latestNote.data ?? []) as unknown as Array<{ id: string; content: string; user_id: string; created_at: string }>;
  const actRows = (acts.data ?? []) as unknown as Array<{ id: string; user_id: string; activity_type: string; subject: string | null; description: string | null; email_subject: string | null; created_at: string }>;
  const auditRows = (audits.data ?? []) as unknown as AuditRow[];
  const firstAuditRows = (firstAudit.data ?? []) as unknown as AuditRow[];
  const appRows = (apps.data ?? []) as unknown as Array<{ id: string; university_name: string; program_name: string; intake_term: string | null; status: string; stage_id: string }>;

  // Application stage names/colours (the app's existing mapping lives on application_stages).
  const stageIds = Array.from(new Set(appRows.map((a) => a.stage_id).filter(Boolean)));
  const stageMap = new Map<string, { name: string; color: string | null; terminal_type: string | null }>();
  if (stageIds.length > 0) {
    const { data: stages } = await db.from("application_stages").select("id, name, color, terminal_type").in("id", stageIds);
    for (const s of (stages ?? []) as unknown as Array<{ id: string; name: string; color: string | null; terminal_type: string | null }>) stageMap.set(s.id, s);
  }

  const userIds = [
    ...taskRows.map((t) => t.assignee_id), ...noteRows.map((n) => n.user_id), ...actRows.map((a) => a.user_id),
    ...auditRows.map((a) => a.user_id), ...firstAuditRows.map((a) => a.user_id), leadRow.assigned_to,
    ...auditRows.map((a) => (a.changes?.assigned_to?.new ? String(a.changes.assigned_to.new) : null)),
  ].filter((x): x is string => !!x);
  const names = await resolveUserNames(userIds);
  const nameOf = (uid: string | null) => (uid ? names.get(uid) ?? null : null);

  // Last touch: latest of logged call/email/meeting and notes.
  const lastAct = actRows[0] ?? null;
  const lastNote = noteRows[0] ?? null;
  let lastTouch: { kind: "call" | "email" | "meeting" | "note"; who_id: string; who_name: string | null; at: string } | null = null;
  if (lastAct && (!lastNote || lastAct.created_at >= lastNote.created_at)) {
    lastTouch = { kind: lastAct.activity_type as "call" | "email" | "meeting", who_id: lastAct.user_id, who_name: nameOf(lastAct.user_id), at: lastAct.created_at };
  } else if (lastNote) {
    lastTouch = { kind: "note", who_id: lastNote.user_id, who_name: nameOf(lastNote.user_id), at: lastNote.created_at };
  }

  // Merged feed: activities + notes + audit events, newest first.
  const sourceLabel =
    (form.data as { name?: string } | null)?.name ?? (leadRow.intake_source ? humanizeIntakeValue(leadRow.intake_source as string) : null);
  const feedCandidates: PreviewActivity[] = [
    ...actRows.map((a) => ({
      id: `a-${a.id}`, at: a.created_at, actor_id: a.user_id, actor_name: nameOf(a.user_id), source: null as string | null, kind: a.activity_type as string,
      verb: a.activity_type === "call" ? "logged a call" : a.activity_type === "email" ? "emailed" : "logged a meeting",
      object: null as string | null, snippet: a.activity_type === "email" ? a.email_subject ?? a.subject : a.subject ?? a.description,
    })),
    ...noteRows.map((n) => ({
      id: `n-${n.id}`, at: n.created_at, actor_id: n.user_id, actor_name: nameOf(n.user_id), source: null as string | null, kind: "note" as string,
      verb: "added a note", object: null as string | null, snippet: n.content,
    })),
    ...[...auditRows, ...firstAuditRows.filter((f) => !auditRows.some((r) => r.id === f.id))].flatMap((r) => {
      const d = describeAuditEvent(r, (uid) => nameOf(uid));
      const creation = isCreationAudit(d.kind, r.changes);
      if (!creation && !SHOWN_AUDIT_KINDS.has(d.kind)) return [];
      const fromForm = (creation || d.kind === "submission") && !r.user_id;
      return [{
        id: `l-${r.id}`, at: r.created_at, actor_id: r.user_id, actor_name: nameOf(r.user_id), kind: creation ? "created" : (d.kind as string),
        source: fromForm ? sourceLabel : null,
        verb: d.verb, object: d.object, snippet: null as string | null,
      }];
    }),
  ];
  const creationRow = [...auditRows, ...firstAuditRows]
    .filter((r) => isCreationAudit(describeAuditEvent(r, (uid) => nameOf(uid)).kind, r.changes))
    .sort((x, y) => String(x.created_at).localeCompare(String(y.created_at)))[0];
  const feed = ensureCreationEvent(feedCandidates, {
    createdAt: leadRow.created_at as string,
    sourceLabel,
    detail: {
      how: creationRow ? creationHow(creationRow.changes) : null,
      source: sourceLabel,
      channel: leadRow.intake_medium ? humanizeIntakeValue(leadRow.intake_medium as string) : null,
      campaign: (leadRow.intake_campaign as string | null) ?? null,
    },
  })
    .sort((x, y) => y.at.localeCompare(x.at)).slice(0, feedLimit);

  const cf = (leadRow.custom_fields ?? {}) as Record<string, unknown>;
  const feeStatus = (leadRow.pre_app_fee_status as string | null) ?? null;

  return apiSuccess({
    tasks: { open_count: openTasks.count ?? taskRows.length, items: taskRows.map((t) => ({ ...t, assignee_name: nameOf(t.assignee_id) })) },
    notes: {
      count: notes.count ?? 0,
      latest: lastNote ? { content: lastNote.content, author_id: lastNote.user_id, author_name: nameOf(lastNote.user_id), created_at: lastNote.created_at } : null,
    },
    last_touch: lastTouch,
    readiness: {
      ready: readiness.ready,
      items: flattenReadiness(readiness.missing),
      consent_signed_at: (consent.data as { signed_at?: string } | null)?.signed_at ?? null,
      has_active_consent_template: !!(tpl.data as { is_active?: boolean } | null)?.is_active,
      fee_status: feeStatus,
    },
    applications: {
      count: apps.count ?? appRows.length,
      items: appRows.slice(0, 3).map((a) => ({
        id: a.id, university: a.university_name, program: a.program_name, status: a.status,
        stage_name: stageMap.get(a.stage_id)?.name ?? null, stage_color: stageMap.get(a.stage_id)?.color ?? null,
        terminal_type: stageMap.get(a.stage_id)?.terminal_type ?? null,
      })),
    },
    activity: feed,
    intake: pickIntake({
      intakeTerm: (leadRow.intake_term as string | null) ?? null,
      preferredIntake: cf.preferred_intake,
      applicationIntakes: appRows.map((a) => a.intake_term),
    }),
    branch_name: (branch.data as { name?: string } | null)?.name ?? null,
    source_name: (form.data as { name?: string } | null)?.name ?? (leadRow.intake_source ? humanizeIntakeValue(leadRow.intake_source as string) : null),
    assignee_name: nameOf(leadRow.assigned_to),
  });
}
