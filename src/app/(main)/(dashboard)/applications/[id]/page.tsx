import { redirect, notFound } from "next/navigation";
import { getCurrentUserTenant, getApplicationActivity } from "@/lib/supabase/queries";
import { getFeatureAccess } from "@/industries/_loader";
import { FEATURES } from "@/industries/_registry";
import { createServiceClient } from "@/lib/supabase/server";
import { shouldRestrictToSelf } from "@/lib/api/permissions";
import { getLeadMembership, branchMemberIds } from "@/lib/leads/branch-membership";
import { ApplicationDetailPage } from "@/industries/education-consultancy/features/application-tracking/pages/application-detail";
import type { Application, ApplicationStage, Lead } from "@/types/database";

interface Props {
  params: Promise<{ id: string }>;
}

export default async function ApplicationDetailRoute({ params }: Props) {
  const { id } = await params;
  const tenantData = await getCurrentUserTenant();
  if (!tenantData) redirect("/login");
  if (!getFeatureAccess(tenantData.tenant.industry_id, FEATURES.APPLICATION_TRACKING)) notFound();

  const supabase = await createServiceClient();

  // Fetch application + stage join
  const { data: appData } = await supabase
    .from("applications")
    .select("*, leads!applications_lead_id_fkey(id,first_name,last_name,email), application_stages!applications_stage_id_fkey(id,name,slug,color,position,terminal_type,is_default)")
    .eq("id", id)
    .eq("tenant_id", tenantData.tenant.id)
    .is("deleted_at", null)
    .maybeSingle();

  if (!appData) notFound();
  const application = appData as unknown as Application;

  // Parent-lead scope guard (mirrors the PATCH/DELETE route in /api/v1/applications/[id]/route.ts)
  const { data: parentLeadData } = await supabase
    .from("leads")
    .select("id, assigned_to, branch_id")
    .eq("id", application.lead_id)
    .eq("tenant_id", tenantData.tenant.id)
    .is("deleted_at", null)
    .maybeSingle();

  if (!parentLeadData) notFound();
  const parentLead = parentLeadData as { id: string; assigned_to: string | null; branch_id: string | null };
  const membership = await getLeadMembership(supabase, tenantData.tenant.id, parentLead.id);

  // shouldRestrictToSelf guard
  if (
    shouldRestrictToSelf(tenantData.permissions) &&
    !(
      parentLead.assigned_to === tenantData.userId ||
      membership.some((m) => m.assigned_to === tenantData.userId)
    )
  ) {
    notFound();
  }

  // requireLeadBranchAccess guard (replicated inline — reads only leadScope, branchId, userId)
  const leadScope = tenantData.permissions.leadScope;
  if (leadScope === "team") {
    const branchId = tenantData.branchId ?? null;
    if (!branchId) {
      if (
        !membership.some((m) => m.assigned_to === tenantData.userId) &&
        parentLead.assigned_to !== tenantData.userId
      ) {
        notFound();
      }
    } else {
      // Mirror requireLeadBranchAccess (auth.ts) + the applications LIST scope:
      // a team-scoped manager may view a lead assigned to a member of their branch.
      const branchMembers = await branchMemberIds(supabase, tenantData.tenant.id, branchId);
      if (!(parentLead.assigned_to !== null && branchMembers.includes(parentLead.assigned_to))) {
        notFound();
      }
    }
  }

  // Fetch all stages ordered by position (for the stepper)
  const { data: stagesData } = await supabase
    .from("application_stages")
    .select("*")
    .eq("tenant_id", tenantData.tenant.id)
    .order("position", { ascending: true });
  const stages = (stagesData ?? []) as ApplicationStage[];

  // Fetch the full lead row for the student rail (phone, city, intake_source, etc.)
  const { data: fullLeadData } = await supabase
    .from("leads")
    .select("*")
    .eq("id", application.lead_id)
    .eq("tenant_id", tenantData.tenant.id)
    .is("deleted_at", null)
    .maybeSingle();
  const fullLead = fullLeadData as Lead | null;

  // Fetch activity timeline server-side
  const activityTimeline = await getApplicationActivity(id, tenantData.tenant.id).catch(() => []);

  return (
    <ApplicationDetailPage
      application={application}
      stages={stages}
      fullLead={fullLead}
      activityTimeline={activityTimeline}
      canManageApplications={tenantData.permissions.canManageApplications}
    />
  );
}
