import { redirect } from "next/navigation";
import { createServiceClient, getCachedUser } from "@/lib/supabase/server";
import {
  getCurrentUserTenant,
  getLeads,
  getMySchedule,
  getMyTasks,
  getMyActiveTimers,
  getMyInboxSnapshot,
  getMyRecentActivity,
  getLeaveForHome,
  getBranches,
  getOutreachDueForHome,
} from "@/lib/supabase/queries";
import { canManageHR } from "@/lib/api/permissions";
import { HomeContent } from "@/components/dashboard/home/home-content";
import { getFeatureAccess } from "@/industries/_loader";
import { FEATURES } from "@/industries/_registry";
import { todayInTz } from "@/lib/hr/dates";
import { deriveHomeTip } from "@/lib/home/tips";
import { authenticateRequest } from "@/lib/api/auth";
import { EducationHome } from "@/industries/education-consultancy/features/home/ui/home-page";
import { loadHome } from "@/industries/education-consultancy/features/home/server/load-page";
import { ManagerHome } from "@/industries/education-consultancy/features/home/ui/manager-home";
import { loadManagerHome } from "@/industries/education-consultancy/features/home/server/load-manager";
import { resolveHomeScope } from "@/industries/education-consultancy/features/home/lib/scope";
import { cookies } from "next/headers";
import type { TenantConfig } from "@/types/database";

export default async function HomePage() {
  const user = await getCachedUser();
  if (!user) redirect("/login");

  const tenantData = await getCurrentUserTenant();
  if (!tenantData) redirect("/login");

  const { tenant, userId, permissions } = tenantData;
  const isEducation = tenant.industry_id === "education_consultancy";

  // Education tenants get the new "Do next" Home (EDGEX-87). Every other industry renders today's HomeContent below, unchanged.
  if (isEducation && getFeatureAccess(tenant.industry_id, FEATURES.EDU_HOME)) {
    const auth = await authenticateRequest();
    if (!auth) redirect("/login");
    const meta = user.user_metadata as Record<string, unknown> | undefined;
    const fullName = (meta?.name ?? meta?.full_name) as string | undefined;
    const firstName = fullName?.trim().split(" ")[0] || user.email?.split("@")[0] || "there";
    const tenantInfo = { timezone: tenant.timezone ?? null, config: (tenant.config as TenantConfig | null) ?? null };

    // Same scope helpers as the leads list: own-scope people get "Do next"; managers and owners get "Needs you".
    const [branchRows, cookieStore] = await Promise.all([getBranches(tenant.id), cookies()]);
    const scope = resolveHomeScope(
      auth.permissions,
      auth.userId,
      auth.branchId,
      cookieStore.get("edgex_branch")?.value ?? null,
      branchRows.map((b) => b.id),
    );
    if (scope.mode === "manager") {
      const data = await loadManagerHome(auth, { name: tenant.name ?? null, ...tenantInfo }, scope, firstName);
      return <ManagerHome data={data} />;
    }
    const data = await loadHome(auth, tenantInfo, firstName);
    return <EducationHome data={data} />;
  }

  const outreachEnabled = getFeatureAccess(tenant.industry_id, FEATURES.OUTREACH);
  const applicationTrackingEnabled = getFeatureAccess(tenant.industry_id, FEATURES.APPLICATION_TRACKING);
  const projectBoardEnabled = getFeatureAccess(tenant.industry_id, FEATURES.PROJECT_BOARD);
  const timeTrackingEnabled = getFeatureAccess(tenant.industry_id, FEATURES.TIME_TRACKING);
  const todayISO = todayInTz(tenant.timezone ?? "Asia/Kathmandu");

  const [schedule, tasks, myLeads, recentActivity, inboxSnapshot, leaveSummary, outreachDue, runningTimersByTask, tenantUserResult] =
    await Promise.all([
      getMySchedule(tenant.id, userId),
      getMyTasks(tenant.id, userId),
      getLeads(tenant.id, { restrictToSelf: true, userId, limit: 50 }),
      getMyRecentActivity(tenant.id, userId),
      getMyInboxSnapshot(tenant.id, userId),
      getLeaveForHome(tenant.id, userId, canManageHR(permissions)),
      outreachEnabled ? getOutreachDueForHome(tenant.id, userId) : Promise.resolve(0),
      timeTrackingEnabled ? getMyActiveTimers(tenant.id, userId) : Promise.resolve({}),
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

  const tip = deriveHomeTip({
    openTasks: tasks.open,
    schedule,
    leads: myLeads,
    unreadCount: inboxSnapshot.unreadCount,
  });

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
      todayISO={todayISO}
      projectBoardEnabled={projectBoardEnabled}
      timeTrackingEnabled={timeTrackingEnabled}
      runningTimersByTask={runningTimersByTask}
      applicationTrackingEnabled={applicationTrackingEnabled}
      currentTenantUserId={currentTenantUserId}
      leaveSummary={leaveSummary}
      outreachDue={outreachDue}
      tip={tip}
    />
  );
}
