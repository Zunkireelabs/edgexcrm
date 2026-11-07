import { scopedClient } from "@/lib/supabase/scoped";
import { resolveUserNames } from "@/lib/supabase/queries";
import { computeMissingDocuments } from "@/lib/documents/missing";
import type { DocumentType } from "@/lib/documents/constants";
import { DOCUMENT_TYPE_LABELS } from "../../applicant-documents/labels";
import { addDaysStr } from "../lib/time";
import { DEADLINE_WINDOW_DAYS } from "../lib/rules/deadline-docs";
import { CONTACT_ACTIVITY_TYPES } from "../lib/contact";
import { loadWorkablePlan } from "./workable";
import { isWorkable } from "../lib/workable";
import type { ContactEvent, HomeApplication, HomeConversation, HomeLead, HomeTask } from "../lib/types";

export type HomeDb = Awaited<ReturnType<typeof scopedClient>>;

/** PostgREST puts the ids in the URL; keep every `.in()` chunk small (an oversized URL was a real prod bug). */
const CHUNK = 100;
function chunk<T>(xs: T[], n = CHUNK): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < xs.length; i += n) out.push(xs.slice(i, i + n));
  return out;
}

const fullName = (f: string | null, l: string | null) => [f, l].filter(Boolean).join(" ").trim() || "Unnamed lead";

interface LeadRow {
  id: string;
  first_name: string | null;
  last_name: string | null;
  phone: string | null;
  assigned_at: string | null;
  created_at: string;
  last_touched_at: string | null;
  callback_due_at: string | null;
  on_hold: boolean | null;
  list_id: string | null;
  destinations: string[] | null;
  tags: string[] | null;
  status: string | null;
  pipeline_id: string | null;
  field_of_study: string | null;
  degree_level: string | null;
}
interface ListRow {
  id: string;
  name: string;
  sort_order: number;
  is_archive: boolean;
  is_staging: boolean | null;
}

export interface LoadedLeads {
  leads: HomeLead[];
  /** lead id → the next stage in the lead's list order (for "Move to next stage"), or null at the end. */
  nextStageByLead: Record<string, { id: string; name: string } | null>;
}

/** Leads ASSIGNED TO ME, not deleted, not archived. The only lead source for Home: it is what scopes a counsellor. */
export async function loadMyLeads(db: HomeDb, userId: string): Promise<LoadedLeads> {
  const [{ data: rows, error }, { data: listRows }, workable] = await Promise.all([
    db
      .from("leads")
      .select("id, first_name, last_name, phone, assigned_at, created_at, last_touched_at, callback_due_at, on_hold, list_id, destinations, tags, status, pipeline_id, field_of_study, degree_level")
      .eq("assigned_to", userId)
      .is("deleted_at", null)
      .is("archived_at", null)
      .limit(2000),
    db.from("lead_lists").select("id, name, sort_order, is_archive, is_staging").order("sort_order", { ascending: true }),
    loadWorkablePlan(db),
  ]);
  if (error) throw new Error(`home: leads query failed: ${error.message}`);
  const lists = (listRows ?? []) as unknown as ListRow[];
  const listById = new Map(lists.map((l) => [l.id, l]));
  const ordered = lists.filter((l) => !l.is_archive && !l.is_staging);

  // Leads with a call-back booked are exactly the leads whose last contact was a no-answer / busy call (the migration-250
  // trigger sets it and any later touch clears it). For those, load the newest contacts (calls / emails / meetings AND
  // human notes: lib/contact.ts) so Home can say "last call: no answer" and spot an unreachable lead (3 unanswered in a row).
  const withCallback = ((rows ?? []) as unknown as LeadRow[]).filter((r) => r.callback_due_at).map((r) => r.id);
  const contacts = new Map<string, ContactEvent[]>();
  for (const ids of chunk(withCallback, 50)) {
    const [acts, notes] = await Promise.all([
      db.from("lead_activities").select("lead_id, activity_type, call_outcome, created_at").in("lead_id", ids).in("activity_type", [...CONTACT_ACTIVITY_TYPES]).order("created_at", { ascending: false }).limit(ids.length * 8),
      db.from("lead_notes").select("lead_id, created_at").in("lead_id", ids).is("ai_tool_call_id", null).order("created_at", { ascending: false }).limit(ids.length * 8),
    ]);
    for (const a of (acts.data ?? []) as unknown as Array<{ lead_id: string; activity_type: ContactEvent["type"]; call_outcome: string | null; created_at: string }>) {
      const l = contacts.get(a.lead_id) ?? [];
      l.push({ type: a.activity_type, outcome: a.call_outcome, at: a.created_at });
      contacts.set(a.lead_id, l);
    }
    for (const n of (notes.data ?? []) as unknown as Array<{ lead_id: string; created_at: string }>) {
      const l = contacts.get(n.lead_id) ?? [];
      l.push({ type: "note", outcome: null, at: n.created_at });
      contacts.set(n.lead_id, l);
    }
  }
  for (const [id, list] of contacts) contacts.set(id, list.sort((x, y) => Date.parse(y.at) - Date.parse(x.at)).slice(0, 6));

  const nextStageByLead: LoadedLeads["nextStageByLead"] = {};
  const leads: HomeLead[] = ((rows ?? []) as unknown as LeadRow[]).map((r) => {
    const list = r.list_id ? listById.get(r.list_id) ?? null : null;
    const idx = list ? ordered.findIndex((l) => l.id === list.id) : -1;
    const next = idx >= 0 ? ordered[idx + 1] ?? null : null;
    nextStageByLead[r.id] = next ? { id: next.id, name: next.name } : null;
    const context = [
      (r.destinations ?? []).slice(0, 2).join(", ") || null,
      [r.degree_level, r.field_of_study].filter(Boolean).join(" ") || null,
    ]
      .filter(Boolean)
      .join(" · ");
    return {
      id: r.id,
      name: fullName(r.first_name, r.last_name),
      phone: r.phone,
      assignedAt: r.assigned_at,
      createdAt: r.created_at,
      lastTouchedAt: r.last_touched_at,
      callbackDueAt: r.callback_due_at,
      onHold: !!r.on_hold,
      // "A lead someone should be working" (lib/workable.ts): active list (no list counts as active), not terminal (won / lost),
      // not a walk-in contact, not on hold. Every Home rule that asks `isActive` inherits it.
      isActive: isWorkable({ list_id: r.list_id, on_hold: r.on_hold, tags: r.tags, status: r.status, pipeline_id: r.pipeline_id }, workable),
      stageName: list?.name ?? null,
      context,
      lastCallOutcome: contacts.get(r.id)?.find((e) => e.type === "call")?.outcome ?? null,
      recentContacts: contacts.get(r.id),
    };
  });
  return { leads, nextStageByLead };
}

interface ConvRow {
  id: string;
  lead_id: string | null;
  contact_display_name: string | null;
  contact_phone: string | null;
  last_message_at: string | null;
  last_message_direction: "inbound" | "outbound" | null;
  last_message_preview: string | null;
  status: "open" | "closed" | "snoozed";
  snoozed_until: string | null;
  provider: string;
}

/** Conversations on my leads or assigned to me whose last message is inbound. */
export async function loadMyConversations(db: HomeDb, userId: string, leadNames: Map<string, string>): Promise<HomeConversation[]> {
  const cols = "id, lead_id, contact_display_name, contact_phone, last_message_at, last_message_direction, last_message_preview, status, snoozed_until, provider";
  const byId = new Map<string, ConvRow>();
  const mine = await db.from("conversations").select(cols).eq("assigned_to_user_id", userId).eq("last_message_direction", "inbound").neq("status", "closed").limit(200);
  for (const c of (mine.data ?? []) as unknown as ConvRow[]) byId.set(c.id, c);
  for (const ids of chunk([...leadNames.keys()])) {
    const { data } = await db.from("conversations").select(cols).in("lead_id", ids).eq("last_message_direction", "inbound").neq("status", "closed").limit(200);
    for (const c of (data ?? []) as unknown as ConvRow[]) byId.set(c.id, c);
  }
  return [...byId.values()]
    .filter((c) => c.last_message_at)
    .map((c) => ({
      id: c.id,
      leadId: c.lead_id,
      contactName: (c.lead_id ? leadNames.get(c.lead_id) : null) ?? c.contact_display_name ?? c.contact_phone ?? "Unknown contact",
      lastMessageAt: c.last_message_at as string,
      lastDirection: c.last_message_direction,
      preview: c.last_message_preview,
      status: c.status,
      snoozedUntil: c.snoozed_until,
      provider: c.provider,
    }));
}

/** My open tasks due today or earlier (tenant-local date). */
export async function loadMyTasks(db: HomeDb, userId: string, today: string): Promise<HomeTask[]> {
  const { data } = await db
    .from("tasks")
    .select("id, title, status, due_date, lead_id, assigned_by_id, created_at, leads(first_name, last_name)")
    .eq("assignee_id", userId)
    .neq("status", "done")
    .not("due_date", "is", null)
    .lte("due_date", today)
    .order("due_date", { ascending: true })
    .limit(200);
  type Row = {
    id: string; title: string; status: HomeTask["status"]; due_date: string | null; lead_id: string | null;
    assigned_by_id: string | null; created_at: string; leads: { first_name: string | null; last_name: string | null } | null;
  };
  const rows = (data ?? []) as unknown as Row[];
  const names = await resolveUserNames(rows.map((r) => r.assigned_by_id).filter((x): x is string => !!x));
  return rows.map((r) => ({
    id: r.id,
    title: r.title,
    status: r.status,
    dueDate: r.due_date,
    leadId: r.lead_id,
    leadName: r.leads ? fullName(r.leads.first_name, r.leads.last_name) : null,
    assignedByName: r.assigned_by_id && r.assigned_by_id !== userId ? names.get(r.assigned_by_id) ?? null : null,
    createdAt: r.created_at,
  }));
}

export interface LoadedApplications {
  applications: HomeApplication[];
  /** pipeline_id (null = legacy no-pipeline stages) → position of its submit stage (application_stages.is_submit_stage). */
  submitStageByPipeline: Map<string | null, number>;
}

/** My live applications, with the missing-documents verdict from the ONE shared definition (computeMissingDocuments). */
export async function loadMyApplications(db: HomeDb, userId: string, today: string): Promise<LoadedApplications> {
  return loadApplications(db, { userId }, today);
}

/**
 * Live applications for one person (`userId`) or for a manager's scope (`branchId`: the lead's branch; null/undefined =
 * the whole tenant). Same verdicts either way; the manager's "applications at risk" row reuses A1's deadline_docs rule.
 */
export async function loadApplications(
  db: HomeDb,
  opts: { userId?: string; branchId?: string | null },
  today: string,
): Promise<LoadedApplications> {
  let appsQuery = db
    .from("applications")
    .select("id, lead_id, assigned_to, university_name, program_name, application_deadline, applied_date, deposit_paid, stage_changed_at, application_stages(name, position, terminal_type, pipeline_id), leads!inner(first_name, last_name, branch_id)")
    .is("deleted_at", null);
  if (opts.userId) appsQuery = appsQuery.eq("assigned_to", opts.userId);
  if (opts.branchId) appsQuery = appsQuery.eq("leads.branch_id", opts.branchId);
  const [appsRes, submitRes, settingsRes] = await Promise.all([
    appsQuery.limit(2000),
    db.from("application_stages").select("pipeline_id, position").eq("is_submit_stage", true),
    db.from("tenant_document_settings").select("required_document_types").maybeSingle(),
  ]);
  type Row = {
    id: string; lead_id: string; assigned_to: string | null; university_name: string; program_name: string; application_deadline: string | null;
    applied_date: string | null; deposit_paid: boolean | null; stage_changed_at: string;
    application_stages: { name: string; position: number; terminal_type: "won" | "lost" | null; pipeline_id: string | null } | null;
    leads: { first_name: string | null; last_name: string | null } | null;
  };
  const rows = (appsRes.data ?? []) as unknown as Row[];
  // A missing column / pre-migration DB must not take Home down: no submit stages → deadline_docs stays silent.
  const submitStageByPipeline = new Map<string | null, number>();
  for (const s of (submitRes.error ? [] : (submitRes.data ?? [])) as unknown as Array<{ pipeline_id: string | null; position: number }>) {
    submitStageByPipeline.set(s.pipeline_id, s.position);
  }
  const required = ((settingsRes.data as unknown as { required_document_types: DocumentType[] } | null)?.required_document_types ?? []) as DocumentType[];

  // Documents are only looked up for applications that can fire deadline_docs (deadline inside the window).
  const last = addDaysStr(today, DEADLINE_WINDOW_DAYS);
  const near = rows.filter((r) => r.application_deadline && r.application_deadline >= today && r.application_deadline <= last);
  const uploaded = new Map<string, Set<string>>();
  if (required.length > 0) {
    for (const ids of chunk([...new Set(near.map((r) => r.lead_id))])) {
      const { data } = await db.from("applicant_documents").select("lead_id, document_type").in("lead_id", ids).is("deleted_at", null);
      for (const d of (data ?? []) as unknown as Array<{ lead_id: string; document_type: string }>) {
        const set = uploaded.get(d.lead_id) ?? new Set<string>();
        set.add(d.document_type);
        uploaded.set(d.lead_id, set);
      }
    }
  }

  const applications: HomeApplication[] = rows
    .filter((r) => r.application_stages)
    .map((r) => {
      const st = r.application_stages as NonNullable<Row["application_stages"]>;
      const verdict = computeMissingDocuments(required, uploaded.get(r.lead_id) ?? []);
      return {
        id: r.id,
        leadId: r.lead_id,
        assigneeId: r.assigned_to,
        leadName: r.leads ? fullName(r.leads.first_name, r.leads.last_name) : "Unnamed lead",
        university: r.university_name,
        program: r.program_name,
        deadline: r.application_deadline,
        appliedDate: r.applied_date,
        depositPaid: !!r.deposit_paid,
        stageName: st.name,
        stage: { position: st.position, terminalType: st.terminal_type, pipelineId: st.pipeline_id },
        stageChangedAt: r.stage_changed_at,
        docs: {
          assessable: verdict.assessable,
          missingLabels: verdict.missing.map((t) => DOCUMENT_TYPE_LABELS[t] ?? "Other"),
          requiredCount: required.length,
        },
      };
    });
  return { applications, submitStageByPipeline };
}

/** Item keys this user snoozed that are still snoozed. */
export async function loadSnoozedKeys(db: HomeDb, userId: string, now: Date): Promise<Set<string>> {
  const { data, error } = await db.from("home_item_snoozes").select("item_key").eq("user_id", userId).gt("until", now.toISOString());
  if (error) return new Set();
  return new Set(((data ?? []) as unknown as Array<{ item_key: string }>).map((r) => r.item_key));
}
