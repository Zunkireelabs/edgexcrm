import { createClient, createServiceClient } from "./server";
import type { Lead, LeadNote, LeadChecklist, Tenant, FormConfig, PipelineStage, PipelineLead } from "@/types/database";

export async function getCurrentUserTenant(): Promise<{
  tenant: Tenant;
  role: string;
  userId: string;
} | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { data: membership } = await supabase
    .from("tenant_users")
    .select("tenant_id, role")
    .eq("user_id", user.id)
    .single();

  if (!membership) return null;

  const { data: tenant } = await supabase
    .from("tenants")
    .select("*")
    .eq("id", membership.tenant_id)
    .single();

  if (!tenant) return null;

  return { tenant: tenant as Tenant, role: membership.role, userId: user.id };
}

export async function getLeads(
  tenantId: string,
  options?: { role?: string; userId?: string; limit?: number }
): Promise<Lead[]> {
  const supabase = await createClient();
  let query = supabase
    .from("leads")
    .select("*")
    .eq("tenant_id", tenantId)
    .is("deleted_at", null)
    .limit(options?.limit ?? 1000);

  if (options?.role === "counselor" && options.userId) {
    query = query.eq("assigned_to", options.userId);
  }

  const { data, error } = await query.order("created_at", { ascending: false });

  if (error) throw error;
  return (data as Lead[]) || [];
}

export async function getLead(
  leadId: string,
  tenantId: string,
  options?: { role?: string; userId?: string }
): Promise<Lead | null> {
  const supabase = await createClient();
  let query = supabase
    .from("leads")
    .select("*")
    .eq("id", leadId)
    .eq("tenant_id", tenantId)
    .is("deleted_at", null);

  if (options?.role === "counselor" && options.userId) {
    query = query.eq("assigned_to", options.userId);
  }

  const { data, error } = await query.single();

  if (error) return null;
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
    .select("id, name, slug, primary_color")
    .eq("slug", slug)
    .single();

  if (!tenant) return null;

  let query = supabase
    .from("form_configs")
    .select("id, tenant_id, slug, steps, branding, redirect_url")
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

export async function getPipelineStages(tenantId: string): Promise<PipelineStage[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("pipeline_stages")
    .select("*")
    .eq("tenant_id", tenantId)
    .order("position", { ascending: true });

  if (error) throw error;
  return (data as PipelineStage[]) || [];
}

export async function getLeadsForPipeline(
  tenantId: string,
  options?: { role?: string; userId?: string }
): Promise<PipelineLead[]> {
  const supabase = await createClient();

  // Fetch leads (limit to 500 for pipeline performance - kanban with 1000+ cards is unusable)
  let query = supabase
    .from("leads")
    .select("*")
    .eq("tenant_id", tenantId)
    .is("deleted_at", null)
    .not("stage_id", "is", null)
    .limit(500);

  if (options?.role === "counselor" && options.userId) {
    query = query.eq("assigned_to", options.userId);
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
