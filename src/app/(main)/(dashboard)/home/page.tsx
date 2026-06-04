import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import {
  getCurrentUserTenant,
  getLeads,
  getMySchedule,
  getMyTasks,
  getMyEmailSnapshot,
  getRecentNotifications,
} from "@/lib/supabase/queries";
import { leadQueryScope } from "@/lib/api/permissions";
import { HomeContent } from "@/components/dashboard/home/home-content";

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

  const [schedule, tasks, myLeads, notifications, emailSnapshot] = await Promise.all([
    getMySchedule(tenant.id, userId),
    getMyTasks(tenant.id, userId),
    getLeads(tenant.id, leadQueryScope(permissions, userId)),
    getRecentNotifications(tenant.id, userId),
    isEducation ? getMyEmailSnapshot(tenant.id, userId) : Promise.resolve(null),
  ]);

  const userName =
    (user.user_metadata?.full_name as string | undefined)?.split(" ")[0] ||
    user.email?.split("@")[0] ||
    "there";

  return (
    <HomeContent
      userName={userName}
      schedule={schedule}
      tasks={tasks}
      myLeads={myLeads}
      notifications={notifications}
      emailSnapshot={emailSnapshot}
      isEducation={isEducation}
    />
  );
}
