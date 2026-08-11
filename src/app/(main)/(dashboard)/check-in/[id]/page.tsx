import { redirect, notFound } from "next/navigation";
import {
  getCurrentUserTenant,
  getLead,
  getPipelineStages,
} from "@/lib/supabase/queries";
import { createServiceClient } from "@/lib/supabase/server";
import { CheckInDetailPage, CheckInNoAccess } from "@/industries/_shared/features/check-in/detail-ui";
import { getFeatureAccess } from "@/industries/_loader";
import { FEATURES } from "@/industries/_registry";
import { canSeeNav, leadQueryScope } from "@/lib/api/permissions";
import type { TenantEntity, LeadNote, PipelineStage } from "@/types/database";

export default async function CheckInDetailRoute({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const tenantData = await getCurrentUserTenant();
  if (!tenantData) redirect("/login");
  if (!getFeatureAccess(tenantData.tenant.industry_id, FEATURES.CHECK_IN)) notFound();
  if (!canSeeNav(tenantData.permissions, "/check-in")) redirect("/dashboard");

  // Tenant-scoped fetch first to tell "doesn't exist" apart from "exists but
  // you're not assigned/collaborator" — the latter gets an explanatory screen,
  // not a 404, since it's reachable from the tenant-wide Check-In history list.
  const rawLead = await getLead(id, tenantData.tenant.id);
  if (!rawLead) notFound();

  const scope = leadQueryScope(tenantData.permissions, tenantData.userId);
  const lead = scope.restrictToSelf ? await getLead(id, tenantData.tenant.id, scope) : rawLead;
  if (!lead) {
    const leadName = [rawLead.first_name, rawLead.last_name].filter(Boolean).join(" ") || null;
    return <CheckInNoAccess leadName={leadName} />;
  }

  const serviceClient = await createServiceClient();

  const [stages, entityResult, checkInNotesResult, teamResult] = await Promise.all([
    getPipelineStages(tenantData.tenant.id),
    lead.entity_id
      ? serviceClient
          .from("tenant_entities")
          .select("*")
          .eq("id", lead.entity_id)
          .single()
      : Promise.resolve({ data: null }),
    serviceClient
      .from("lead_notes")
      .select("id, content, created_at, user_email")
      .eq("lead_id", id)
      .like("content", "[CHECK-IN]%")
      .order("created_at", { ascending: false }),
    serviceClient
      .from("tenant_users")
      .select("user_id, role, users:user_id(email)")
      .eq("tenant_id", tenantData.tenant.id),
  ]);

  const entity = entityResult.data as TenantEntity | null;
  const checkInNotes = (checkInNotesResult.data || []) as Pick<LeadNote, "id" | "content" | "created_at" | "user_email">[];

  // Build member map for assigned_to display
  const memberMap: Record<string, string> = {};
  if (teamResult.data) {
    for (const m of teamResult.data) {
      const user = m.users as unknown as { email: string } | null;
      if (user?.email) {
        memberMap[m.user_id] = user.email;
      }
    }
  }

  // Find the lead's stage and pipeline info
  const allStages = stages as PipelineStage[];
  const currentStage = allStages.find((s) => s.id === lead.stage_id);

  // Get pipeline name
  let pipelineName: string | null = null;
  if (lead.pipeline_id) {
    const { data: pipeline } = await serviceClient
      .from("pipelines")
      .select("name")
      .eq("id", lead.pipeline_id)
      .single();
    pipelineName = pipeline?.name || null;
  }

  // Reaching this line already means "allowed to see this check-in" (assignee,
  // collaborator, or unrestricted role) — but the full lead profile is a step
  // further and stays limited to the current assignee / unrestricted roles, so
  // a collaborator who only did a past check-in doesn't get the full record.
  const canViewFullProfile = !scope.restrictToSelf || lead.assigned_to === tenantData.userId;

  return (
    <CheckInDetailPage
      lead={lead}
      stageName={currentStage?.name || null}
      stageColor={currentStage?.color || null}
      pipelineName={pipelineName}
      entityName={entity?.name || null}
      assignedToEmail={lead.assigned_to ? memberMap[lead.assigned_to] || null : null}
      checkInHistory={checkInNotes}
      canViewFullProfile={canViewFullProfile}
    />
  );
}
