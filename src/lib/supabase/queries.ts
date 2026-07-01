import { createClient, createServiceClient } from "./server";
import type { Lead, LeadList, LeadNote, LeadChecklist, Tenant, FormConfig, PipelineStage, PipelineLead, Pipeline, PipelineWithCounts, UserRole, TaskStatus, TaskPriority, Branch, ImportSourceReconciliationRow } from "@/types/database";
import { resolvePermissions, positionPermissionsFromEmbed, type ResolvedPermissions, type PositionPermissions } from "@/lib/api/permissions";
import { resolveEntitlements, type Entitlements } from "@/lib/api/entitlements";
import { branchMemberIds, sharedBranchLeadIdsForAssignee, getLeadMembership } from "@/lib/leads/branch-membership";
import { collaboratorLeadIdsForUser, isLeadCollaborator } from "@/lib/leads/collaborators";

export async function getCurrentUserTenant(): Promise<{
  tenant: Tenant;
  role: string;
  userId: string;
  positionId: string | null;
  positionName: string | null;
  positionSlug: string | null;
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
    .select("tenant_id, role, position_id, branch_id, positions(permissions, name, slug)")
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
    positionSlug: (positionEmbed?.slug ?? null) as string | null,
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
    onlyDeleted?: boolean;
  }
): Promise<Lead[]> {
  const supabase = await createClient();

  // Compute filter sets once. Both self-scope (counselor) and branch-scope use INLINE column
  // filters (assigned_to) rather than .in("id", 500+ uuids), which overflows Node/undici's 16 KB
  // URL limit (UND_ERR_HEADERS_OVERFLOW) and returns empty results.
  let sharedIds: string[] | null = null;
  let memberIds: string[] | null = null;
  if (scope?.restrictToSelf && scope.userId) {
    // Widen own-scope to leads the user has ever been assigned (collaborators),
    // so handed-off leads stay visible. Merged with branch shared-in ids.
    const [branchShared, collab] = await Promise.all([
      sharedBranchLeadIdsForAssignee(supabase, tenantId, scope.userId),
      collaboratorLeadIdsForUser(supabase, tenantId, scope.userId),
    ]);
    // Cap at 300 UUIDs — ~11 KB — to stay well under undici's 16 KB URL limit.
    sharedIds = [...new Set([...branchShared, ...collab])].slice(0, 300);
  } else if (scope?.branchId) {
    // branchMemberIds reads OTHER users' tenant_users rows. The RLS client (createClient) can't
    // see them — the tenant_users SELECT policy is (user_id = auth.uid()) — so it would return []
    // and .in("assigned_to", []) yields zero leads. Use the service client to resolve real members.
    const svc = await createServiceClient();
    memberIds = await branchMemberIds(svc, tenantId, scope.branchId);
  }

  // Factory applied on every range page so all filters + stable sort are consistent.
  // `widen` controls the own-scope collaborator/shared-branch widening: when false we fall
  // back to a plain assigned_to filter (used if the widened OR query errors — see loop below).
  const buildQuery = (widen: boolean) => {
    let q = supabase
      .from("leads")
      .select("*")
      .eq("tenant_id", tenantId)
      .is("converted_at", null)
      .order("created_at", { ascending: false })
      .order("id", { ascending: false });

    // Recycle bin: show soft-deleted leads; otherwise hide them (default).
    if (scope?.onlyDeleted) {
      q = q.not("deleted_at", "is", null);
    } else {
      q = q.is("deleted_at", null);
    }

    // Scope (hotfix shape — inline assigned_to filters, never .in("id", 500+ uuids) which
    // overflows undici's 16KB URL limit). DO NOT replace with .in("id", selfIds/branchIds).
    if (scope?.restrictToSelf && scope.userId) {
      if (widen && sharedIds && sharedIds.length > 0) {
        q = q.or(`assigned_to.eq.${scope.userId},id.in.(${sharedIds.join(",")})`);
      } else {
        q = q.eq("assigned_to", scope.userId);
      }
    } else if (memberIds !== null) {
      // Include unassigned leads in this branch too (e.g. a walk-in just created via
      // Check-In, before anyone claims it) — .in("assigned_to", memberIds) alone never
      // matches NULL, so an unassigned branch lead would otherwise be invisible here.
      if (memberIds.length > 0) {
        q = q.or(`assigned_to.in.(${memberIds.join(",")}),and(assigned_to.is.null,branch_id.eq.${scope!.branchId})`);
      } else {
        q = q.is("assigned_to", null).eq("branch_id", scope!.branchId as string);
      }
    }

    if (scope?.pipelineIds) q = q.in("pipeline_id", scope.pipelineIds);

    // List filters don't apply to the recycle bin (it spans all lists).
    if (!scope?.onlyDeleted) {
      if (scope?.listId) {
        q = q.eq("list_id", scope.listId);
      } else if (scope?.excludeListIds && scope.excludeListIds.length > 0) {
        // Master view for education: show leads not in any archive list (NULL list_id is included)
        q = q.or(`list_id.is.null,list_id.not.in.(${scope.excludeListIds.join(",")})`);
      }
    }

    return q;
  };

  // TEMPORARY: loads the whole list into the client; proper server-side pagination is the real roadmap fix.
  // PostgREST caps each response at max-rows=1000, so .limit() alone can't exceed that. We page in CHUNK-sized
  // slices via .range() and concatenate until a short page or the caller's ceiling (scope.limit) is reached.
  const CHUNK = 1000;
  const max = scope?.limit ?? 1000;

  // Page through every range with a FIXED widen setting. Returns null on any page error
  // so the caller can cleanly retry the WHOLE query with a narrower filter — avoiding
  // mid-stream offset drift or a permanently-flipped flag (both would silently drop rows).
  const fetchPaged = async (widen: boolean): Promise<Lead[] | null> => {
    const acc: Lead[] = [];
    for (let from = 0; from < max; from += CHUNK) {
      const to = Math.min(from + CHUNK, max) - 1;
      const { data, error } = await buildQuery(widen).range(from, to);
      if (error) {
        console.error("[getLeads] leads query page failed", {
          tenantId, listId: scope?.listId, from, widen, error,
        });
        return null;
      }
      acc.push(...((data ?? []) as Lead[]));
      if (!data || data.length < CHUNK) break;
    }
    return acc;
  };

  // Own-scope users start widened (so collaborator/shared-branch leads show too).
  const widenInitial = !!(scope?.restrictToSelf && scope.userId && sharedIds && sharedIds.length > 0);
  let result = await fetchPaged(widenInitial);
  // Defensive: if the widened own-scope query failed, retry the WHOLE query assigned-only
  // (from offset 0) so a user's own leads never vanish behind a collaborator-widening failure.
  if (result === null && widenInitial) {
    console.error("[getLeads] widened own-scope query failed; retrying assigned-only", {
      tenantId, userId: scope?.userId, sharedIdCount: sharedIds?.length,
    });
    result = await fetchPaged(false);
  }
  return result ?? [];
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
      // Collaborators (anyone ever assigned) keep view access after reassignment / list moves.
      const isCollab = isAssignee || (await isLeadCollaborator(supabase, tenantId, leadId, scope.userId));
      if (!isCollab) return null;
    }
    if (scope.branchId) {
      // Service client: tenant_users RLS hides other users' rows from the RLS client.
      const svc = await createServiceClient();
      const memberIds = await branchMemberIds(svc, tenantId, scope.branchId);
      // Unassigned lead (e.g. a walk-in just created via Check-In): fall back to a
      // branch match, same as requireLeadBranchAccess in src/lib/api/auth.ts.
      const branchOk = data.assigned_to
        ? memberIds.includes(data.assigned_to)
        : data.branch_id === scope.branchId;
      if (!branchOk) return null;
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
    .is("list_id", null)
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

export async function getListPipeline(
  listId: string,
  tenantId: string,
): Promise<{ pipeline: Pipeline; stages: PipelineStage[] } | null> {
  const supabase = await createClient();

  const { data: list } = await supabase
    .from("lead_lists")
    .select("pipeline_id")
    .eq("id", listId)
    .eq("tenant_id", tenantId)
    .single();

  if (!list?.pipeline_id) return null;

  const [{ data: pipeline }, { data: stages }] = await Promise.all([
    supabase.from("pipelines").select("*").eq("id", list.pipeline_id).single(),
    supabase
      .from("pipeline_stages")
      .select("*")
      .eq("pipeline_id", list.pipeline_id)
      .eq("tenant_id", tenantId)
      .order("position", { ascending: true }),
  ]);

  if (!pipeline) return null;
  return { pipeline: pipeline as Pipeline, stages: (stages || []) as PipelineStage[] };
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
    // Inline column filter avoids .in("id", 500+ uuids) URL overflow.
    // Widen to collaborator leads (ever assigned) so handed-off leads stay on the board.
    const [shared, collab] = await Promise.all([
      sharedBranchLeadIdsForAssignee(supabase, tenantId, options.userId),
      collaboratorLeadIdsForUser(supabase, tenantId, options.userId),
    ]);
    // Cap at 300 UUIDs — ~11 KB — to stay well under undici's 16 KB URL limit.
    const extra = [...new Set([...shared, ...collab])].slice(0, 300);
    if (extra.length > 0) {
      query = query.or(`assigned_to.eq.${options.userId},id.in.(${extra.join(",")})`);
    } else {
      query = query.eq("assigned_to", options.userId);
    }
  } else if (options?.branchId) {
    // Service client: tenant_users RLS hides other users' rows from the RLS client.
    const svc = await createServiceClient();
    const memberIds = await branchMemberIds(svc, tenantId, options.branchId);
    // Include unassigned leads in this branch too — see getLeads() above for why.
    if (memberIds.length > 0) {
      query = query.or(`assigned_to.in.(${memberIds.join(",")}),and(assigned_to.is.null,branch_id.eq.${options.branchId})`);
    } else {
      query = query.is("assigned_to", null).eq("branch_id", options.branchId);
    }
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

function resolveDisplayName(email: string, meta?: Record<string, unknown> | null): string {
  const raw = ((meta?.name ?? meta?.full_name ?? "") as string).trim();
  if (!raw || raw.toLowerCase() === email.toLowerCase()) {
    return email.split("@")[0];
  }
  return raw;
}

export interface TeamMember {
  id: string;
  user_id: string;
  role: string;
  email: string;
  name: string;
  branch_id: string | null;
  created_at: string;
  /** Position-derived: can this member act on (be assigned) leads? Drives assignee dropdowns. */
  canEditLeads: boolean;
  /** Slug of the member's current position (null if no position assigned). */
  position_slug: string | null;
  /** Display name of the member's current position (null if no position assigned). */
  position_name: string | null;
}

export async function getTeamMembers(tenantId: string): Promise<TeamMember[]> {
  const supabase = await createServiceClient();
  const { data: members, error } = await supabase
    .from("tenant_users")
    .select("id, user_id, role, branch_id, created_at, position_id, positions(permissions, name, slug)")
    .eq("tenant_id", tenantId)
    .order("created_at", { ascending: true });

  if (error) throw error;

  // Race listUsers against a 7s deadline — it has no built-in timeout, so a slow GoTrue
  // response can stall the entire page indefinitely. Map-miss fallback below returns "Unknown".
  const TIMEOUT_MS = 7_000;
  let authData: Awaited<ReturnType<typeof supabase.auth.admin.listUsers>>["data"] | null = null;
  try {
    const timeoutPromise = new Promise<null>((resolve) =>
      setTimeout(() => resolve(null), TIMEOUT_MS)
    );
    const result = await Promise.race([
      supabase.auth.admin.listUsers().then((r) => r.data),
      timeoutPromise,
    ]);
    authData = result;
    if (!result) {
      console.error("[getTeamMembers] auth.admin.listUsers() timed out after", TIMEOUT_MS, "ms — members will show as Unknown");
    }
  } catch (listErr) {
    console.error("[getTeamMembers] auth.admin.listUsers() failed — members will show as Unknown", listErr);
  }
  const userMap = new Map<string, { email: string; name: string }>();
  for (const u of authData?.users || []) {
    const email = u.email || "";
    const meta = u.user_metadata as Record<string, unknown> | undefined;
    userMap.set(u.id, { email, name: resolveDisplayName(email, meta) });
  }

  return (members || []).map((m) => {
    const user = userMap.get(m.user_id) ?? { email: "Unknown", name: "Unknown" };
    // Resolve position → permissions to decide assignability (position is the source of truth,
    // not the legacy `role`).
    const { canEditLeads } = resolvePermissions(
      m.role as UserRole,
      positionPermissionsFromEmbed(m.positions),
    );
    const posEmbed = Array.isArray(m.positions) ? (m.positions[0] ?? null) : m.positions;
    return {
      id: m.id,
      user_id: m.user_id,
      role: m.role,
      email: user.email,
      name: user.name,
      branch_id: (m.branch_id as string | null) ?? null,
      created_at: m.created_at,
      canEditLeads,
      position_slug: (posEmbed as { slug?: string; name?: string } | null)?.slug ?? null,
      position_name: (posEmbed as { slug?: string; name?: string } | null)?.name ?? null,
    };
  });
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

// ---- Home: my open conversations (Inbox widget) ----

export interface InboxConversationItem {
  id: string;
  contact_display_name: string | null;
  contact_phone: string | null;
  last_message_preview: string | null;
  last_message_at: string | null;
  unread_count: number;
}

export interface InboxSnapshot {
  items: InboxConversationItem[];
  unreadCount: number;
}

/** Open conversations assigned to the current user (the home Inbox widget). */
export async function getMyInboxSnapshot(tenantId: string, userId: string): Promise<InboxSnapshot> {
  const supabase = await createServiceClient();
  const { data } = await supabase
    .from("conversations")
    .select("id, contact_display_name, contact_phone, last_message_preview, last_message_at, unread_count")
    .eq("tenant_id", tenantId)
    .eq("assigned_to_user_id", userId)
    .eq("status", "open")
    .order("last_message_at", { ascending: false, nullsFirst: false })
    .limit(5);

  const items = (data ?? []) as InboxConversationItem[];
  const unreadCount = items.reduce((n, c) => n + (c.unread_count || 0), 0);
  return { items, unreadCount };
}

// ---- Home: my own recent actions (Recent Activity widget) ----

export interface RecentActivityItem {
  id: string;
  title: string;
  message: string;
  link: string | null;
  read_at: string | null;
  created_at: string;
}

const AUDIT_ACTION_LABELS: Record<string, string> = {
  "lead.submission": "New lead submission",
  "lead.updated": "Updated a lead",
  "lead.merged": "Merged a duplicate lead",
  "lead.note_added": "Added a note",
  "lead.branch_shared": "Shared a lead to a branch",
  "lead.branch_revoked": "Removed a lead from a branch",
  "lead.branch_assigned": "Assigned a lead in a branch",
  "consent.sent": "Sent a consent request",
  "consent.signed": "Recorded a signed consent",
  "consent_template.updated": "Updated the consent template",
};

function labelForAuditAction(action: string): string {
  return (
    AUDIT_ACTION_LABELS[action] ??
    action.replace(/[._]/g, " ").replace(/\b\w/g, (c) => c.toUpperCase())
  );
}

/**
 * The current user's own recent actions (from audit_logs, actor = me) — what
 * *I* did, not notifications sent to me. Lead entities are enriched with the
 * lead name + a deep link.
 */
export async function getMyRecentActivity(
  tenantId: string,
  userId: string,
): Promise<RecentActivityItem[]> {
  const supabase = await createServiceClient();
  const { data, error } = await supabase
    .from("audit_logs")
    .select("id, action, entity_type, entity_id, created_at")
    .eq("tenant_id", tenantId)
    .eq("user_id", userId)
    .order("created_at", { ascending: false })
    .limit(8);

  if (error || !data) return [];
  const rows = data as Array<{
    id: string;
    action: string;
    entity_type: string;
    entity_id: string;
    created_at: string;
  }>;

  // Enrich lead entities with their names in one batch query.
  const leadIds = Array.from(
    new Set(rows.filter((r) => r.entity_type === "lead").map((r) => r.entity_id)),
  );
  const nameById = new Map<string, string>();
  if (leadIds.length > 0) {
    const { data: leads } = await supabase
      .from("leads")
      .select("id, first_name, last_name")
      .in("id", leadIds);
    for (const l of (leads ?? []) as Array<{ id: string; first_name: string | null; last_name: string | null }>) {
      const name = [l.first_name, l.last_name].filter(Boolean).join(" ").trim();
      if (name) nameById.set(l.id, name);
    }
  }

  return rows.map((r) => ({
    id: r.id,
    title: labelForAuditAction(r.action),
    message:
      r.entity_type === "lead"
        ? nameById.get(r.entity_id) ?? "Lead"
        : r.entity_type.replace(/_/g, " "),
    link: r.entity_type === "lead" ? `/leads/${r.entity_id}` : null,
    // Past actions render as a neutral (non-alert) dot.
    read_at: r.created_at,
    created_at: r.created_at,
  }));
}

export async function getImportSourceReconciliation(
  tenantId: string,
  stagingListId: string,
): Promise<ImportSourceReconciliationRow[]> {
  const supabase = await createServiceClient();
  const { data, error } = await supabase.rpc("reconcile_import_sources", {
    p_tenant: tenantId,
    p_staging_list: stagingListId,
  });
  if (error) throw error;
  return (data ?? []) as ImportSourceReconciliationRow[];
}


export interface TeamMemberWithPosition {
  user_id: string;
  display: string;
  position_name: string | null;
  position_slug: string | null;
}

export async function getTeamMembersWithPositions(
  tenantId: string,
): Promise<TeamMemberWithPosition[]> {
  const supabase = await createServiceClient();
  const { data: members, error } = await supabase
    .from("tenant_users")
    .select("user_id, positions(name, slug)")
    .eq("tenant_id", tenantId);

  if (error) throw error;

  const TIMEOUT_MS = 7_000;
  let authData2: Awaited<ReturnType<typeof supabase.auth.admin.listUsers>>["data"] | null = null;
  try {
    const timeoutPromise = new Promise<null>((resolve) =>
      setTimeout(() => resolve(null), TIMEOUT_MS)
    );
    const result = await Promise.race([
      supabase.auth.admin.listUsers().then((r) => r.data),
      timeoutPromise,
    ]);
    authData2 = result;
    if (!result) {
      console.error("[getTeamMembersWithPositions] auth.admin.listUsers() timed out after", TIMEOUT_MS, "ms");
    }
  } catch (listErr) {
    console.error("[getTeamMembersWithPositions] auth.admin.listUsers() failed", listErr);
  }
  const userMap = new Map<string, { email: string; name: string }>();
  for (const u of authData2?.users || []) {
    const email = u.email || "";
    const meta = u.user_metadata as Record<string, unknown> | undefined;
    userMap.set(u.id, { email, name: resolveDisplayName(email, meta) });
  }

  return (members || []).map((m) => {
    const posEmbed = Array.isArray(m.positions)
      ? (m.positions[0] ?? null)
      : m.positions;
    const user = userMap.get(m.user_id) ?? { email: "", name: "" };
    return {
      user_id: m.user_id,
      display: user.name || user.email.split("@")[0] || user.email,
      position_name: (posEmbed as { name?: string; slug?: string } | null)?.name ?? null,
      position_slug: (posEmbed as { name?: string; slug?: string } | null)?.slug ?? null,
    };
  });
}
