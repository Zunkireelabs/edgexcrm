import { redirect } from "next/navigation";
import { getCurrentUserTenant } from "@/lib/supabase/queries";
import { NotificationsPage } from "@/components/dashboard/notifications-page";

// Thin shell: notifications belong to the signed-in user (every role, every industry), so the only
// gate is being logged in. The list itself is fetched client-side from /api/v1/notifications.
export default async function NotificationsRoute() {
  const tenantData = await getCurrentUserTenant();
  if (!tenantData) redirect("/login");
  return <NotificationsPage />;
}
