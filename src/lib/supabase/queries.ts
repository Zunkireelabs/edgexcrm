import { createClient, createServiceClient } from "./server";
import { scopedClientForTenant } from "./scoped";
import type { Lead, LeadList, LeadNote, LeadChecklist, Tenant, FormConfig, PipelineStage, PipelineLead, Pipeline, PipelineWithCounts, UserRole, TaskStatus, TaskPriority, Branch, ImportSourceReconciliationRow } from "@/types/database";
import { resolvePermissions, positionPermissionsFromEmbed, type ResolvedPermissions, type PositionPermissions } from "@/lib/api/permissions";
import { resolveEntitlements, type Entitlements } from "@/lib/api/entitlements";
import { branchMemberIds, getLeadMembership } from "@/lib/leads/branch-membership";
import { isLeadCollaborator } from "@/lib/leads/collaborators";
import type { LeadSubmissionSnapshot } from "@/lib/leads/submission-history";
import { visibleLeadsBase, type LeadVisibilityScope } from "@/lib/leads/visibility-query";

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

/**
 * Live lead count per list, for sidebar stage rows. Scoped to the viewer (D1,
 * migration 179): owner/admin get tenant-wide counts (unchanged); a counselor or
 * branch-manager's badge now matches exactly the rows they see in that list,
 * instead of a tenant-wide count via the service client.
 */
export async function getLeadListCounts(
  tenantId: string,
  listIds: string[],
  // Required (not optional) so every call site makes an explicit choice — an
  // accidentally-omitted scope must not silently fall back to tenant-wide counts.
  // Pass `undefined` explicitly for the owner/admin (unrestricted) case.
  scope: LeadVisibilityScope | undefined,
): Promise<Record<string, number>> {
  if (listIds.length === 0) return {};
  const supabase = await createClient();
  const counts: Record<string, number> = {};
  // Single visibility-scoped query covering all lists, paged like the pre-migration-179
  // version — NOT one RPC call per list (that fired N round trips on every page nav).
  const CHUNK = 1000;
  for (let from = 0; ; from += CHUNK) {
    const { data, error } = await visibleLeadsBase(supabase, tenantId, scope)
      .in("list_id", listIds)
      .is("deleted_at", null)
      .is("converted_at", null)
      .range(from, from + CHUNK - 1);
    if (error) throw error;
    for (const row of data ?? []) {
      const lid = (row as { list_id: string | null }).list_id;
      if (lid) counts[lid] = (counts[lid] ?? 0) + 1;
    }
    if (!data || data.length < CHUNK) break;
  }
  return counts;
}

export async function getLeads(
  tenantId: string,
  scope?: {
    restrictToSelf?: boolean;
    userId?: string;
    pipelineIds?: string[] | null;
    limit?: number;
    branchId?: string | null;
    userBranchId?: string | null;
    crossBranchPoolListSlug?: string | null;
    listId?: string | null;
    /** Funnel-wide view: leads whose list_id is any of the funnel's stage-lists. */
    listIds?: string[] | null;
    excludeListIds?: string[];
    onlyDeleted?: boolean;
    excludeOtherType?: boolean;
  }
): Promise<Lead[]> {
  const supabase = await createClient();

  // Shared filter chain applied on top of whichever base the caller resolves to (the
  // visibility-scoped RPC, or the plain assigned-only fallback below) so both stay
  // in lockstep — a stable sort + every non-visibility filter, identical either way.
  const applyFilters = (q: ReturnType<typeof visibleLeadsBase>) => {
    q = q
      .is("converted_at", null)
      .order("created_at", { ascending: false })
      .order("id", { ascending: false });

    // Recycle bin: show soft-deleted leads; otherwise hide them (default).
    if (scope?.onlyDeleted) {
      q = q.not("deleted_at", "is", null);
    } else {
      q = q.is("deleted_at", null);
    }

    if (scope?.pipelineIds) q = q.in("pipeline_id", scope.pipelineIds);

    // Exclude "other" type contacts from funnel views — they're walk-in visitors only
    if (scope?.excludeOtherType) q = q.not("tags", "cs", '{"other"}');

    // List filters don't apply to the recycle bin (it spans all lists).
    if (!scope?.onlyDeleted) {
      if (scope?.listId) {
        q = q.eq("list_id", scope.listId);
      } else if (scope?.listIds && scope.listIds.length > 0) {
        q = q.in("list_id", scope.listIds);
      } else if (scope?.excludeListIds && scope.excludeListIds.length > 0) {
        // Master view for education: show leads not in any archive list (NULL list_id is included)
        q = q.or(`list_id.is.null,list_id.not.in.(${scope.excludeListIds.join(",")})`);
      }
    }

    return q;
  };

  // Base query is visibility-scoped via leads_visible_to_user() (own/branch, uncapped —
  // migration 179) or the plain unrestricted select (owner/admin, unchanged).
  const buildQuery = () => applyFilters(visibleLeadsBase(supabase, tenantId, scope));

  // Own-scope fallback: a plain assigned-only query, bypassing the visibility RPC
  // entirely. Restores the pre-migration-179 safety net — if the RPC ever errors
  // (bad param, transient DB error), a counselor's directly-assigned leads must
  // still render instead of the page going blank.
  const buildFallbackQuery = () =>
    applyFilters(supabase.from("leads").select("*").eq("tenant_id", tenantId).eq("assigned_to", scope!.userId!));

  // TEMPORARY: loads the whole list into the client; proper server-side pagination is the real roadmap fix.
  // PostgREST caps each response at max-rows=1000, so .limit() alone can't exceed that. We page in CHUNK-sized
  // slices via .range() and concatenate until a short page or the caller's ceiling (scope.limit) is reached.
  const CHUNK = 1000;
  const max = scope?.limit ?? 1000;

  // Page through every range with a FIXED query builder. Returns null on any page error
  // so the caller can cleanly retry the WHOLE query with a narrower filter — avoiding
  // mid-stream offset drift (partial-then-narrowed results would silently drop rows).
  const fetchPaged = async (build: () => ReturnType<typeof applyFilters>): Promise<Lead[] | null> => {
    const acc: Lead[] = [];
    for (let from = 0; from < max; from += CHUNK) {
      const to = Math.min(from + CHUNK, max) - 1;
      const { data, error } = await build().range(from, to);
      if (error) {
        console.error("[getLeads] leads query page failed", { tenantId, listId: scope?.listId, from, error });
        return null;
      }
      acc.push(...((data ?? []) as Lead[]));
      if (!data || data.length < CHUNK) break;
    }
    return acc;
  };

  let result = await fetchPaged(buildQuery);
  // Defensive: if the own-scope visibility-RPC query failed, retry assigned-only
  // (from offset 0) so a user's own leads never vanish behind an RPC failure.
  if (result === null && scope?.restrictToSelf && scope.userId) {
    console.error("[getLeads] own-scope visibility query failed; retrying assigned-only", {
      tenantId, userId: scope.userId,
    });
    result = await fetchPaged(buildFallbackQuery);
  }
  return result ?? [];
}

/**
 * it_agency Sales Leads "no next task" signal — which of the given leads have at
 * least one open (todo/in_progress) task. Structure only: no automated alerting yet.
 */
export async function getOpenTaskLeadIds(tenantId: string, leadIds: string[]): Promise<Set<string>> {
  if (leadIds.length === 0) return new Set();
  const supabase = await createServiceClient();
  const openIds = new Set<string>();
  const CHUNK = 200; // keep the .in() filter well under undici's 16KB URL cap
  for (let i = 0; i < leadIds.length; i += CHUNK) {
    const chunk = leadIds.slice(i, i + CHUNK);
    const { data, error } = await supabase
      .from("tasks")
      .select("lead_id")
      .eq("tenant_id", tenantId)
      .in("lead_id", chunk)
      .in("status", ["todo", "in_progress"]);
    if (error) throw error;
    for (const row of data ?? []) {
      const lid = (row as { lead_id: string | null }).lead_id;
      if (lid) openIds.add(lid);
    }
  }
  return openIds;
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
      // In-branch via the lead_branches roster, a direct branch_id, or a
      // branch-member assignee. Mirrors requireLeadBranchAccess / requireLeadAccess
      // and the getLeads list scope so the detail page matches the list — a lead a
      // branch manager sees in their list must open, not 404.
      const branchOk =
        membership.some((m) => m.branch_id === scope.branchId) ||
        data.branch_id === scope.branchId ||
        (data.assigned_to !== null && memberIds.includes(data.assigned_to));
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
  options?: {
    restrictToSelf?: boolean;
    userId?: string;
    pipelineIds?: string[] | null;
    pipelineId?: string;
    branchId?: string | null;
    excludeOtherType?: boolean;
  }
): Promise<PipelineLead[]> {
  const supabase = await createClient();

  // Fetch leads (limit to 500 for pipeline performance - kanban with 1000+ cards is unusable)
  // Own-scope base is visibility-scoped via leads_visible_to_user() (uncapped; migration 179).
  // Branch-scope stays the plain unrestricted select — its narrower members-only OR clause
  // below is applied on top, unchanged (Decision D2 — do not unify with getLeads' branch scope).
  let query = (options?.restrictToSelf && options.userId
    ? visibleLeadsBase(supabase, tenantId, { restrictToSelf: true, userId: options.userId })
    : supabase.from("leads").select("*").eq("tenant_id", tenantId))
    .is("deleted_at", null)
    .is("converted_at", null)
    .not("stage_id", "is", null)
    .limit(500);

  // Exclude "other" type contacts from the board — they're walk-in visitors only.
  if (options?.excludeOtherType) query = query.not("tags", "cs", '{"other"}');

  if (options?.pipelineId) {
    // If this specific pipeline isn't in the allowed set, return empty immediately.
    if (options.pipelineIds && !options.pipelineIds.includes(options.pipelineId)) return [];
    query = query.eq("pipeline_id", options.pipelineId);
  } else if (options?.pipelineIds) {
    query = query.in("pipeline_id", options.pipelineIds);
  }

  if (options?.branchId && !(options?.restrictToSelf && options.userId)) {
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

  const { data: leadsData, error: leadsError } = await query.order("created_at", { ascending: false });
  if (leadsError) throw leadsError;
  const leads = (leadsData ?? []) as Lead[];
  if (leads.length === 0) return [];

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

export async function getBranchIds(tenantId: string): Promise<string[]> {
  const supabase = await createClient();
  const { data } = await supabase.from("branches").select("id").eq("tenant_id", tenantId);
  return (data ?? []).map((b) => b.id as string);
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

// Every raw form submission this lead has ever made, oldest first — the source
// of truth for "what distinct answers has this person given across repeat
// submissions" (see src/lib/leads/submission-history.ts).
export async function getLeadSubmissionHistory(
  leadId: string,
  tenantId: string
): Promise<LeadSubmissionSnapshot[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("lead_submissions")
    .select("custom_fields")
    .eq("lead_id", leadId)
    .eq("tenant_id", tenantId)
    .order("created_at", { ascending: true });

  if (error) throw error;
  return (data as LeadSubmissionSnapshot[]) || [];
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
  assigned_by_id: string | null;
  assigned_by_name: string | null;
  project_id: string | null;
  lead_id: string | null;
  deal_id: string | null;
  is_billable: boolean;
  position: number;
  tags: string[];
  created_at: string;
  updated_at: string;
  leads: { id: string; first_name: string | null; last_name: string | null } | null;
  deals: { id: string; name: string } | null;
  projects: { id: string; name: string } | null;
}

export interface MyTasksResult {
  open: PersonalTask[];
  done: PersonalTask[];
}

/** Batch-resolve display names for a set of user IDs (single auth.admin.listUsers() call — no N+1). */
export async function resolveUserNames(userIds: string[]): Promise<Map<string, string>> {
  const ids = Array.from(new Set(userIds.filter(Boolean)));
  const map = new Map<string, string>();
  if (ids.length === 0) return map;

  const supabase = await createServiceClient();
  const TIMEOUT_MS = 7_000;
  try {
    const timeoutPromise = new Promise<null>((resolve) => setTimeout(() => resolve(null), TIMEOUT_MS));
    const result = await Promise.race([
      supabase.auth.admin.listUsers({ perPage: 1000 }).then((r) => r.data),
      timeoutPromise,
    ]);
    for (const u of result?.users ?? []) {
      if (!ids.includes(u.id)) continue;
      const meta = u.user_metadata as Record<string, unknown> | undefined;
      map.set(u.id, resolveDisplayName(u.email || "", meta));
    }
  } catch (err) {
    console.error("[resolveUserNames] auth.admin.listUsers() failed", err);
  }
  return map;
}

export async function getMyTasks(tenantId: string, userId: string): Promise<MyTasksResult> {
  const supabase = await createServiceClient();
  const { data, error } = await supabase
    .from("tasks")
    .select("*, leads(id, first_name, last_name), deals(id, name), projects(id, name)")
    .eq("tenant_id", tenantId)
    .eq("assignee_id", userId)
    .order("due_date", { ascending: true, nullsFirst: false })
    .order("created_at", { ascending: false });

  if (error) return { open: [], done: [] };

  const rawTasks = (data ?? []) as unknown as Omit<PersonalTask, "assigned_by_name">[];
  const nameMap = await resolveUserNames(rawTasks.map((t) => t.assigned_by_id).filter((id): id is string => !!id));
  const tasks: PersonalTask[] = rawTasks.map((t) => ({
    ...t,
    assigned_by_name: t.assigned_by_id ? nameMap.get(t.assigned_by_id) ?? null : null,
  }));

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

// ---- Home: leave attention counts ----

export interface LeaveHomeSummary {
  pendingLeaveApprovals: number;
  myPendingLeave: number;
}

/**
 * Pending-leave counts for the Home attention summary: requests waiting on
 * *my* approval (all pending requests for canManageHR, else only ones
 * resolved to me as approver) and my own pending requests.
 */
export async function getLeaveForHome(
  tenantId: string,
  userId: string,
  hasManageHR: boolean,
): Promise<LeaveHomeSummary> {
  const supabase = await createServiceClient();

  const { data: membership } = await supabase
    .from("tenant_users")
    .select("id")
    .eq("tenant_id", tenantId)
    .eq("user_id", userId)
    .maybeSingle();
  const selfTenantUserId = (membership as { id: string } | null)?.id ?? null;
  if (!selfTenantUserId) return { pendingLeaveApprovals: 0, myPendingLeave: 0 };

  let approvalsQuery = supabase
    .from("leave_requests")
    .select("id", { count: "exact", head: true })
    .eq("tenant_id", tenantId)
    .eq("approval_status", "pending");
  if (!hasManageHR) approvalsQuery = approvalsQuery.eq("approver_tenant_user_id", selfTenantUserId);

  const [approvalsRes, mineRes] = await Promise.all([
    approvalsQuery,
    supabase
      .from("leave_requests")
      .select("id", { count: "exact", head: true })
      .eq("tenant_id", tenantId)
      .eq("tenant_user_id", selfTenantUserId)
      .eq("approval_status", "pending"),
  ]);

  return {
    pendingLeaveApprovals: approvalsRes.count ?? 0,
    myPendingLeave: mineRes.count ?? 0,
  };
}

// ---- Home: outreach drafts due (Attention summary line + sidebar badge) ----

/**
 * Count of MY pending outreach drafts already due (personal scope, every
 * role including owner/admin — this is My-Work, not the company worklist).
 * Mirrors the /api/v1/outreach/drafts worklist's active-enrollment inner
 * join so a paused/completed enrollment's draft drops out of the count.
 * Caller must gate on getFeatureAccess(industryId, FEATURES.OUTREACH) first.
 */
export async function getOutreachDueForHome(tenantId: string, userId: string): Promise<number> {
  const db = await scopedClientForTenant(tenantId);
  const { count } = await db
    .from("sequence_step_drafts")
    .select("id, sequence_enrollments!inner(status)", { count: "exact", head: true })
    .eq("assigned_to", userId)
    .eq("status", "pending")
    .lte("due_at", new Date().toISOString())
    .eq("sequence_enrollments.status", "active");
  return count ?? 0;
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
