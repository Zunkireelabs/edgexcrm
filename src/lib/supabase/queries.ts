import { createClient, createServiceClient } from "./server";
import type { Lead, LeadList, LeadNote, LeadChecklist, Tenant, FormConfig, PipelineStage, PipelineLead, Pipeline, PipelineWithCounts, UserRole, TaskStatus, TaskPriority, Branch } from "@/types/database";
import { resolvePermissions, type ResolvedPermissions, type PositionPermissions } from "@/lib/api/permissions";
import { resolveEntitlements, type Entitlements } from "@/lib/api/entitlements";
import { leadIdsForBranch, leadIdsVisibleToAssignee, getLeadMembership } from "@/lib/leads/branch-membership";

export async function getCurrentUserTenant(): Promise<{
  tenant: Tenant;
  role: string;
  userId: string;
  positionId: string | null;
  positionName: string | null;
  permissions: ResolvedPermissions;
  entitlements: Entitlements;
  branchId: string | null;
} | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { data: membership } = await supabase
    .from("tenant_users")
    .select("tenant_id, role, position_id, branch_id, positions(permissions, name)")
    .eq("user_id", user.id)
    .single();

  if (!membership) return null;

  const { data: tenant } = await supabase
    .from("tenants")
    .select("*")
    .eq("id", membership.tenant_id)
    .single();

  if (!tenant) return null;

  const positionEmbed = Array.isArray(membership.positions)
    ? membership.positions[0] ?? null
    : membership.positions;
  const permissions = resolvePermissions(
    membership.role as UserRole,
    (positionEmbed?.permissions ?? null) as PositionPermissions | null,
  );

  return {
    tenant: tenant as Tenant,
    role: membership.role,
    userId: user.id,
    positionId: (membership.position_id as string | null) ?? null,
    positionName: (positionEmbed?.name ?? null) as string | null,
    permissions,
    entitlements: resolveEntitlements(tenant as Tenant),
    branchId: (membership.branch_id as string | null) ?? null,
  };
}

export async function getLeadListsByTenant(tenantId: string): Promise<LeadList[]> {
  const supabase = await createServiceClient();
  const { data, error } = await supabase
    .from("lead_lists")
    .select("*")
    .eq("tenant_id", tenantId)
    .order("sort_order", { ascending: true });
  if (error) throw error;
  return (data as LeadList[]) || [];
}

export async function getLeads(
  tenantId: string,
  scope?: {
    restrictToSelf?: boolean;
    userId?: string;
    pipelineIds?: string[] | null;
    limit?: number;
    branchId?: string | null;
    listId?: string | null;
    excludeListIds?: string[];
  }
): Promise<Lead[]> {
  const supabase = await createClient();

  // Compute id-lists once (async) before the chunk loop.
  let selfIds: string[] | null = null;
  let branchIds: string[] | null = null;
  if (scope?.restrictToSelf && scope.userId) {
    selfIds = await leadIdsVisibleToAssignee(supabase, tenantId, scope.userId);
  } else if (scope?.branchId) {
    branchIds = await leadIdsForBranch(supabase, tenantId, scope.branchId);
  }

  // Factory applied on every chunk so all filters + stable sort are consistent.
  const buildQuery = () => {
    let q = supabase
      .from("leads")
      .select("*")
      .eq("tenant_id", tenantId)
      .is("deleted_at", null)
      .is("converted_at", null)
      .order("created_at", { ascending: false })
      .order("id", { ascending: false });

    if (selfIds !== null) q = q.in("id", selfIds);
    else if (branchIds !== null) q = q.in("id", branchIds);

    if (scope?.pipelineIds) q = q.in("pipeline_id", scope.pipelineIds);

    if (scope?.listId) {
      q = q.eq("list_id", scope.listId);
    } else if (scope?.excludeListIds && scope.excludeListIds.length > 0) {
      // Master view for education: show leads not in any archive list (NULL list_id is included)
      q = q.or(`list_id.is.null,list_id.not.in.(${scope.excludeListIds.join(",")})`);
    }

    return q;
  };

  // TEMPORARY: loads the whole list into the client; proper server-side pagination is the real roadmap fix.
  // PostgREST caps each response at max-rows=1000, so .limit() alone can't exceed that. We page in CHUNK-sized
  // slices via .range() and concatenate until a short page or the caller's ceiling (scope.limit) is reached.
  const CHUNK = 1000;
  const max = scope?.limit ?? 1000;
  const out: Lead[] = [];
  for (let from = 0; from < max; from += CHUNK) {
    const to = Math.min(from + CHUNK, max) - 1;
    const { data, error } = await buildQuery().range(from, to);
    if (error) break;
    out.push(...((data ?? []) as Lead[]));
    if (!data || data.length < CHUNK) break;
  }
  return out;
}

export async function getLead(
  leadId: string,
  tenantId: string,
  scope?: { restrictToSelf?: boolean; userId?: string; pipelineIds?: string[] | null; branchId?: string | null }
): Promise<Lead | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("leads")
    .select("*")
    .eq("id", leadId)
    .eq("tenant_id", tenantId)
    .is("deleted_at", null)
    .single();

  if (error) return null;

  // Membership-based scoping (fixes the prior gap where branchId was never checked in SSR).
  if (scope && (scope.restrictToSelf || scope.branchId)) {
    const membership = await getLeadMembership(supabase, tenantId, leadId);
    if (scope.restrictToSelf && scope.userId) {
      const isAssignee = membership.some((m) => m.assigned_to === scope.userId) || data?.assigned_to === scope.userId;
      if (!isAssignee) return null;
    }
    if (scope.branchId) {
      if (!membership.some((m) => m.branch_id === scope.branchId)) return null;
    }
  }

  // If pipeline access is restricted and this lead's pipeline isn't allowed, hide it.
  if (scope?.pipelineIds && data?.pipeline_id && !scope.pipelineIds.includes(data.pipeline_id)) {
    return null;
  }
  return data as Lead;
}

export async function getLeadNotes(leadId: string): Promise<LeadNote[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("lead_notes")
    .select("*")
    .eq("lead_id", leadId)
    .order("created_at", { ascending: false });

  if (error) throw error;
  return (data as LeadNote[]) || [];
}

export async function getFormConfigByTenantSlug(
  slug: string,
  formSlug?: string
): Promise<{ formConfig: FormConfig; tenant: Tenant } | null> {
  // Use service client (no cookies) so form pages can be statically generated
  const supabase = await createServiceClient();

  // Only select columns needed by PublicForm component
  const { data: tenant } = await supabase
    .from("tenants")
    .select("id, name, slug, primary_color, industry_id")
    .eq("slug", slug)
    .single();

  if (!tenant) return null;

  let query = supabase
    .from("form_configs")
    .select("id, tenant_id, slug, steps, branding, redirect_url, attribution")
    .eq("tenant_id", tenant.id)
    .eq("is_active", true);

  if (formSlug) {
    query = query.eq("slug", formSlug);
  }

  // If no formSlug, get the first active form (backwards compat)
  const { data: formConfig } = await query.order("created_at", { ascending: true }).limit(1).single();

  if (!formConfig) return null;

  return {
    formConfig: formConfig as FormConfig,
    tenant: tenant as Tenant,
  };
}

export async function getFormConfigsForTenant(
  tenantId: string
): Promise<FormConfig[]> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("form_configs")
    .select("*")
    .eq("tenant_id", tenantId)
    .eq("is_active", true)
    .order("created_at", { ascending: true });

  if (error) throw error;
  return (data as FormConfig[]) || [];
}

export async function getPipelineStages(
  tenantId: string,
  pipelineId?: string
): Promise<PipelineStage[]> {
  const supabase = await createClient();
  let query = supabase
    .from("pipeline_stages")
    .select("*")
    .eq("tenant_id", tenantId);

  if (pipelineId) {
    query = query.eq("pipeline_id", pipelineId);
  }

  const { data, error } = await query.order("position", { ascending: true });

  if (error) throw error;
  return (data as PipelineStage[]) || [];
}

export async function getPipelines(tenantId: string): Promise<PipelineWithCounts[]> {
  const supabase = await createClient();

  const { data: pipelines, error } = await supabase
    .from("pipelines")
    .select("*")
    .eq("tenant_id", tenantId)
    .eq("is_active", true)
    .order("position", { ascending: true });

  if (error) throw error;

  // Get stage counts per pipeline
  const { data: stageCounts } = await supabase
    .from("pipeline_stages")
    .select("pipeline_id")
    .eq("tenant_id", tenantId);

  // Get lead counts per pipeline
  const { data: leadCounts } = await supabase
    .from("leads")
    .select("pipeline_id")
    .eq("tenant_id", tenantId)
    .is("deleted_at", null)
    .is("converted_at", null);

  // Aggregate counts
  const stageCountMap = new Map<string, number>();
  const leadCountMap = new Map<string, number>();

  for (const s of stageCounts || []) {
    stageCountMap.set(s.pipeline_id, (stageCountMap.get(s.pipeline_id) || 0) + 1);
  }

  for (const l of leadCounts || []) {
    if (l.pipeline_id) {
      leadCountMap.set(l.pipeline_id, (leadCountMap.get(l.pipeline_id) || 0) + 1);
    }
  }

  return (pipelines || []).map((p) => ({
    ...p,
    stage_count: stageCountMap.get(p.id) || 0,
    lead_count: leadCountMap.get(p.id) || 0,
  })) as PipelineWithCounts[];
}

export async function getDefaultPipeline(tenantId: string): Promise<Pipeline | null> {
  const supabase = await createClient();

  const { data, error } = await supabase
    .from("pipelines")
    .select("*")
    .eq("tenant_id", tenantId)
    .eq("is_default", true)
    .single();

  if (error) return null;
  return data as Pipeline;
}

export async function getLeadsForPipeline(
  tenantId: string,
  options?: { restrictToSelf?: boolean; userId?: string; pipelineIds?: string[] | null; pipelineId?: string; branchId?: string | null }
): Promise<PipelineLead[]> {
  const supabase = await createClient();

  // Fetch leads (limit to 500 for pipeline performance - kanban with 1000+ cards is unusable)
  let query = supabase
    .from("leads")
    .select("*")
    .eq("tenant_id", tenantId)
    .is("deleted_at", null)
    .is("converted_at", null)
    .not("stage_id", "is", null)
    .limit(500);

  if (options?.pipelineId) {
    // If this specific pipeline isn't in the allowed set, return empty immediately.
    if (options.pipelineIds && !options.pipelineIds.includes(options.pipelineId)) return [];
    query = query.eq("pipeline_id", options.pipelineId);
  } else if (options?.pipelineIds) {
    query = query.in("pipeline_id", options.pipelineIds);
  }

  if (options?.restrictToSelf && options.userId) {
    const ids = await leadIdsVisibleToAssignee(supabase, tenantId, options.userId);
    query = query.in("id", ids);
  } else if (options?.branchId) {
    const ids = await leadIdsForBranch(supabase, tenantId, options.branchId);
    query = query.in("id", ids);
  }

  const { data: leads, error: leadsError } = await query.order("created_at", { ascending: false });
  if (leadsError) throw leadsError;
  if (!leads || leads.length === 0) return [];

  // Fetch checklist counts - use tenant_id filter instead of .in() to avoid URL length limits
  const { data: checklistCounts, error: clError } = await supabase
    .from("lead_checklists")
    .select("lead_id, is_completed")
    .eq("tenant_id", tenantId);

  if (clError) throw clError;

  // Create a set of lead IDs for fast lookup
  const leadIdSet = new Set(leads.map((l) => l.id));

  // Aggregate counts per lead (only for leads we're displaying)
  const countsMap = new Map<string, { total: number; completed: number }>();
  for (const item of checklistCounts || []) {
    if (!leadIdSet.has(item.lead_id)) continue;
    const entry = countsMap.get(item.lead_id) || { total: 0, completed: 0 };
    entry.total++;
    if (item.is_completed) entry.completed++;
    countsMap.set(item.lead_id, entry);
  }

  return leads.map((lead) => {
    const counts = countsMap.get(lead.id) || { total: 0, completed: 0 };
    return {
      ...(lead as Lead),
      checklist_total: counts.total,
      checklist_completed: counts.completed,
    };
  });
}

export interface TeamMember {
  id: string;
  user_id: string;
  role: string;
  email: string;
  created_at: string;
}

export async function getTeamMembers(tenantId: string): Promise<TeamMember[]> {
  const supabase = await createServiceClient();
  const { data: members, error } = await supabase
    .from("tenant_users")
    .select("id, user_id, role, created_at")
    .eq("tenant_id", tenantId)
    .order("created_at", { ascending: true });

  if (error) throw error;

  const { data: authData } = await supabase.auth.admin.listUsers();
  const userMap = new Map<string, string>();
  for (const u of authData?.users || []) {
    userMap.set(u.id, u.email || "");
  }

  return (members || []).map((m) => ({
    id: m.id,
    user_id: m.user_id,
    role: m.role,
    email: userMap.get(m.user_id) || "Unknown",
    created_at: m.created_at,
  }));
}

export async function getBranches(tenantId: string): Promise<Branch[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("branches")
    .select("*")
    .eq("tenant_id", tenantId)
    .order("sort_order", { ascending: true });
  return (data as Branch[]) ?? [];
}

export async function getLeadChecklists(leadId: string): Promise<LeadChecklist[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("lead_checklists")
    .select("*")
    .eq("lead_id", leadId)
    .order("position", { ascending: true });

  if (error) throw error;
  return (data as LeadChecklist[]) || [];
}

export interface LeadActivity {
  id: string;
  action: string;
  entity_type: string;
  changes: Record<string, { old: unknown; new: unknown }>;
  user_id: string | null;
  created_at: string;
}

export async function getLeadActivity(leadId: string, tenantId: string): Promise<LeadActivity[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("audit_logs")
    .select("id, action, entity_type, changes, user_id, created_at")
    .eq("tenant_id", tenantId)
    .eq("entity_id", leadId)
    .eq("entity_type", "lead")
    .order("created_at", { ascending: false })
    .limit(50);

  if (error) throw error;
  return (data as LeadActivity[]) || [];
}

export async function getApplicationActivity(applicationId: string, tenantId: string): Promise<LeadActivity[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("audit_logs")
    .select("id, action, entity_type, changes, user_id, created_at")
    .eq("tenant_id", tenantId)
    .eq("entity_id", applicationId)
    .eq("entity_type", "application")
    .order("created_at", { ascending: false })
    .limit(50);

  if (error) throw error;
  return (data as LeadActivity[]) || [];
}

// ── Home-view query helpers ──────────────────────────────────────────────────

export interface ScheduleActivity {
  id: string;
  activity_type: string;
  subject: string | null;
  scheduled_at: string;
  location: string | null;
  lead_id: string;
  leads: { id: string; first_name: string | null; last_name: string | null } | null;
}

export async function getMySchedule(tenantId: string, userId: string): Promise<ScheduleActivity[]> {
  const supabase = await createServiceClient();
  const { data, error } = await supabase
    .from("lead_activities")
    .select("id, activity_type, subject, scheduled_at, location, lead_id, leads(id, first_name, last_name)")
    .eq("tenant_id", tenantId)
    .eq("user_id", userId)
    .in("activity_type", ["meeting", "call"])
    .not("scheduled_at", "is", null)
    .is("completed_at", null)
    .order("scheduled_at", { ascending: true })
    .limit(20);

  if (error) return [];
  return (data ?? []) as unknown as ScheduleActivity[];
}

export interface PersonalTask {
  id: string;
  tenant_id: string;
  title: string;
  description: string | null;
  status: TaskStatus;
  priority: TaskPriority;
  due_date: string | null;
  assignee_id: string | null;
  project_id: string | null;
  lead_id: string | null;
  is_billable: boolean;
  position: number;
  tags: string[];
  created_at: string;
  updated_at: string;
  leads: { id: string; first_name: string | null; last_name: string | null } | null;
}

export interface MyTasksResult {
  open: PersonalTask[];
  done: PersonalTask[];
}

export async function getMyTasks(tenantId: string, userId: string): Promise<MyTasksResult> {
  const supabase = await createServiceClient();
  const { data, error } = await supabase
    .from("tasks")
    .select("*, leads(id, first_name, last_name)")
    .eq("tenant_id", tenantId)
    .eq("assignee_id", userId)
    .order("due_date", { ascending: true, nullsFirst: false })
    .order("created_at", { ascending: false });

  if (error) return { open: [], done: [] };

  const tasks = (data ?? []) as unknown as PersonalTask[];
  return {
    open: tasks.filter((t) => t.status !== "done"),
    done: tasks.filter((t) => t.status === "done").slice(0, 10),
  };
}

export interface EmailSnapshotItem {
  id: string;
  from_email: string;
  from_name: string | null;
  subject: string | null;
  received_at: string | null;
  thread_id: string;
}

export interface EmailSnapshot {
  items: EmailSnapshotItem[];
  unreadCount: number;
}

export async function getMyEmailSnapshot(tenantId: string, userId: string): Promise<EmailSnapshot> {
  const supabase = await createServiceClient();

  const { data: accounts } = await supabase
    .from("connected_email_accounts")
    .select("id")
    .eq("tenant_id", tenantId)
    .eq("user_id", userId);

  const ids = (accounts ?? []).map((a) => a.id);
  if (ids.length === 0) return { items: [], unreadCount: 0 };

  const { data: emails, count } = await supabase
    .from("emails")
    .select("id, from_email, from_name, subject, received_at, thread_id", { count: "exact" })
    .in("connected_email_account_id", ids)
    .eq("direction", "inbound")
    .is("read_at", null)
    .order("received_at", { ascending: false })
    .limit(5);

  return {
    items: (emails ?? []) as EmailSnapshotItem[],
    unreadCount: count ?? 0,
  };
}

export interface RecentNotification {
  id: string;
  type: string;
  title: string;
  message: string;
  link: string | null;
  read_at: string | null;
  created_at: string;
}

export async function getRecentNotifications(
  tenantId: string,
  userId: string,
): Promise<RecentNotification[]> {
  const supabase = await createServiceClient();
  const { data, error } = await supabase
    .from("notifications")
    .select("id, type, title, message, link, read_at, created_at")
    .eq("tenant_id", tenantId)
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(8);

  if (error) return [];
  return (data ?? []) as RecentNotification[];
}
