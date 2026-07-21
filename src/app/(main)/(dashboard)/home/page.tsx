import { redirect } from "next/navigation";
import { createClient, createServiceClient } from "@/lib/supabase/server";
import {
  getCurrentUserTenant,
  getLeads,
  getMySchedule,
  getMyTasks,
  getMyInboxSnapshot,
  getMyRecentActivity,
  getLeaveForHome,
  getOutreachDueForHome,
} from "@/lib/supabase/queries";
import { canManageHR } from "@/lib/api/permissions";
import { HomeContent } from "@/components/dashboard/home/home-content";
import { getFeatureAccess } from "@/industries/_loader";
import { FEATURES } from "@/industries/_registry";

export default async function HomePage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const tenantData = await getCurrentUserTenant();
  if (!tenantData) redirect("/login");

  const { tenant, userId, permissions } = tenantData;
  const isEducation = tenant.industry_id === "education_consultancy";
  const isItAgency = tenant.industry_id === "it_agency";
  const outreachEnabled = getFeatureAccess(tenant.industry_id, FEATURES.OUTREACH);

  const [schedule, tasks, myLeads, recentActivity, inboxSnapshot, leaveSummary, outreachDue, tenantUserResult] =
    await Promise.all([
      getMySchedule(tenant.id, userId),
      getMyTasks(tenant.id, userId),
      getLeads(tenant.id, { restrictToSelf: true, userId, limit: 50 }),
      getMyRecentActivity(tenant.id, userId),
      getMyInboxSnapshot(tenant.id, userId),
      getLeaveForHome(tenant.id, userId, canManageHR(permissions)),
      outreachEnabled ? getOutreachDueForHome(tenant.id, userId) : Promise.resolve(0),
      (await createServiceClient())
        .from("tenant_users")
        .select("id")
        .eq("tenant_id", tenant.id)
        .eq("user_id", userId)
        .maybeSingle(),
    ]);
  const currentTenantUserId = tenantUserResult.data?.id ?? null;

  const meta = user.user_metadata as Record<string, unknown> | undefined;
  const fullName = (meta?.name ?? meta?.full_name) as string | undefined;
  const userName = fullName?.trim().split(" ")[0] || user.email?.split("@")[0] || "there";

  return (
    <HomeContent
      userId={userId}
      userName={userName}
      schedule={schedule}
      tasks={tasks}
      myLeads={myLeads}
      recentActivity={recentActivity}
      inboxSnapshot={inboxSnapshot}
      isEducation={isEducation}
      isItAgency={isItAgency}
      currentTenantUserId={currentTenantUserId}
      leaveSummary={leaveSummary}
      outreachDue={outreachDue}
    />
  );
}
