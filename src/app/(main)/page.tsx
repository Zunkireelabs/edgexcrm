import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUserTenant } from "@/lib/supabase/queries";

// Single decision point for where an authenticated user lands. All post-auth
// redirects (login, register, OAuth callback, middleware) funnel through "/"
// so the industry-aware landing choice lives in one place.
export default async function Home() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // Not signed in → login. (Only unauthenticated users reach this branch, so no
  // /login ⇄ / redirect loop with the middleware.)
  if (!user) {
    redirect("/login");
  }

  // Signed in. Education Consultancy tenants land on Home; every other industry
  // (and a signed-in user with no tenant, whom the dashboard layout greets with
  // its no-tenant error) keeps Dashboard.
  const tenantData = await getCurrentUserTenant();
  redirect(
    tenantData?.tenant.industry_id === "education_consultancy" ? "/home" : "/dashboard"
  );
}
