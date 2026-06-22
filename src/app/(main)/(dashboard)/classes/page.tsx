import { redirect, notFound } from "next/navigation";
import { getCurrentUserTenant } from "@/lib/supabase/queries";
import { getFeatureAccess } from "@/industries/_loader";
import { FEATURES } from "@/industries/_registry";
import { createServiceClient } from "@/lib/supabase/server";
import { leadQueryScope } from "@/lib/api/permissions";
import { leadIdsVisibleToAssignee, leadIdsForBranch } from "@/lib/leads/branch-membership";
import { ClassesWorkspace } from "@/industries/education-consultancy/features/classes/pages/classes-workspace";

export default async function ClassesRoute() {
  const tenantData = await getCurrentUserTenant();
  if (!tenantData) redirect("/login");
  if (!getFeatureAccess(tenantData.tenant.industry_id, FEATURES.CLASSES)) notFound();

  const supabase = await createServiceClient();

  const scope = leadQueryScope(tenantData.permissions, tenantData.userId, tenantData.branchId ?? null);

  let leadIds: string[] | null = null;

  if (scope.restrictToSelf && scope.userId) {
    leadIds = await leadIdsVisibleToAssignee(supabase, tenantData.tenant.id, scope.userId);
  } else if (scope.branchId) {
    leadIds = await leadIdsForBranch(supabase, tenantData.tenant.id, scope.branchId);
  }

  const [classesResult, enrollmentsResult] = await Promise.all([
    supabase
      .from("classes")
      .select("id, name, default_fee, is_active")
      .eq("tenant_id", tenantData.tenant.id)
      .eq("is_active", true)
      .order("name", { ascending: true }),
    leadIds !== null && leadIds.length === 0
      ? Promise.resolve({ data: [] })
      : (() => {
          let q = supabase
            .from("class_enrollments")
            .select("*, leads!class_enrollments_lead_id_fkey(id,first_name,last_name,email,assigned_to)")
            .eq("tenant_id", tenantData.tenant.id)
            .is("deleted_at", null)
            .order("created_at", { ascending: false });
          if (leadIds && leadIds.length > 0) q = q.in("lead_id", leadIds);
          return q;
        })(),
  ]);

  const classes = (classesResult.data ?? []) as Array<{
    id: string;
    name: string;
    default_fee: number | null;
    is_active: boolean;
  }>;
  const enrollments = (enrollmentsResult.data ?? []) as Array<Record<string, unknown>>;

  return (
    <div className="flex flex-col h-[calc(100vh-90px)]">
      <ClassesWorkspace
        classes={classes}
        enrollments={enrollments}
        canManage={tenantData.permissions.canManageClasses}
        tenantId={tenantData.tenant.id}
      />
    </div>
  );
}
