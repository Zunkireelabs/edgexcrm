import { redirect, notFound } from "next/navigation";
import { getCurrentUserTenant } from "@/lib/supabase/queries";
import { getFeatureAccess } from "@/industries/_loader";
import { FEATURES } from "@/industries/_registry";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import { leadQueryScope, canEnrollStudents } from "@/lib/api/permissions";
import { branchMemberIds } from "@/lib/leads/branch-membership";
import { visibleLeadsBase } from "@/lib/leads/visibility-query";
import { POSITION_ROUTE_MAP } from "@/industries/education-consultancy/features/new-leads-triage/position-routing";
import { ClassesWorkspace } from "@/industries/education-consultancy/features/classes/pages/classes-workspace";
import type { SupabaseClient } from "@supabase/supabase-js";

// Fetch enrollments in 250-ID chunks to avoid Node/undici 16 KB URL limit.
async function fetchEnrollmentsByLeadIds(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  supabase: SupabaseClient<any>,
  tenantId: string,
  leadIds: string[] | null,
): Promise<Array<Record<string, unknown>>> {
  if (leadIds !== null && leadIds.length === 0) return [];

  const buildQ = (chunk?: string[]) => {
    let q = supabase
      .from("class_enrollments")
      .select("*, leads!class_enrollments_lead_id_fkey(id,first_name,last_name,email,assigned_to)")
      .eq("tenant_id", tenantId)
      .is("deleted_at", null)
      .order("created_at", { ascending: false });
    if (chunk && chunk.length > 0) q = q.in("lead_id", chunk);
    return q;
  };

  const CHUNK_SIZE = 250;
  if (!leadIds || leadIds.length <= CHUNK_SIZE) {
    const { data } = await buildQ(leadIds ?? undefined);
    return (data ?? []) as Array<Record<string, unknown>>;
  }

  const chunks: string[][] = [];
  for (let i = 0; i < leadIds.length; i += CHUNK_SIZE) {
    chunks.push(leadIds.slice(i, i + CHUNK_SIZE));
  }
  const results = await Promise.all(chunks.map((chunk) => buildQ(chunk)));
  return results.flatMap((r) => (r.data ?? []) as Array<Record<string, unknown>>);
}

export default async function ClassesRoute() {
  const tenantData = await getCurrentUserTenant();
  if (!tenantData) redirect("/login");
  if (!getFeatureAccess(tenantData.tenant.industry_id, FEATURES.CLASSES)) notFound();

  const supabase = await createServiceClient();
  const userClient = await createClient(); // RLS-context client — leads_visible_to_user() needs a real auth.uid()

  const poolSlug = tenantData.tenant.industry_id === "education_consultancy" && tenantData.positionSlug && tenantData.branchId
    ? (POSITION_ROUTE_MAP[tenantData.positionSlug] ?? null)
    : null;
  const scope = leadQueryScope(tenantData.permissions, tenantData.userId, tenantData.branchId ?? null, poolSlug);

  let leadIds: string[] | null = null;
  let teamMemberIds: string[] | null = null;

  if (scope.restrictToSelf && scope.userId) {
    // Visibility-scoped (uncapped; migration 179) — includes collaborator-visible leads,
    // not just direct assignments.
    const { data, error } = await visibleLeadsBase(userClient, tenantData.tenant.id, scope).is("deleted_at", null);
    if (error) {
      console.error("[classes/page] own-scope lead visibility query failed", {
        tenantId: tenantData.tenant.id, userId: scope.userId, error,
      });
    }
    leadIds = (data ?? []).map((l: { id: string }) => l.id);
  } else if (scope.branchId) {
    teamMemberIds = await branchMemberIds(supabase, tenantData.tenant.id, scope.branchId);
  }

  const [classesResult, enrollments] = await Promise.all([
    supabase
      .from("classes")
      .select("id, name, default_fee, is_active")
      .eq("tenant_id", tenantData.tenant.id)
      .eq("is_active", true)
      .order("name", { ascending: true }),
    // Branch scope: inner-embed filter on the assignee's branch (no lead-id enumeration).
    // Self/all scope: chunked lead_id filter (overflow-safe) via the shared helper.
    teamMemberIds !== null
      ? (async () => {
          const { data } = await supabase
            .from("class_enrollments")
            .select("*, leads!class_enrollments_lead_id_fkey!inner(id,first_name,last_name,email,assigned_to)")
            .eq("tenant_id", tenantData.tenant.id)
            .is("deleted_at", null)
            .order("created_at", { ascending: false })
            .in("leads.assigned_to", teamMemberIds);
          return (data ?? []) as Array<Record<string, unknown>>;
        })()
      : fetchEnrollmentsByLeadIds(supabase, tenantData.tenant.id, leadIds),
  ]);

  const classes = (classesResult.data ?? []) as Array<{
    id: string;
    name: string;
    default_fee: number | null;
    is_active: boolean;
  }>;

  return (
    <div className="flex flex-col h-[calc(100vh-90px)]">
      <ClassesWorkspace
        classes={classes}
        enrollments={enrollments}
        canManage={tenantData.permissions.canManageClasses}
        canEnroll={canEnrollStudents(tenantData.permissions, tenantData.positionSlug)}
        tenantId={tenantData.tenant.id}
      />
    </div>
  );
}
