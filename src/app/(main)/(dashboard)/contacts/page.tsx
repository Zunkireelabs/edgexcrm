import { redirect, notFound } from "next/navigation";
import { getCurrentUserTenant, getLeads } from "@/lib/supabase/queries";
import { createServiceClient } from "@/lib/supabase/server";
import { ContactsPage } from "@/industries/education-consultancy/features/contacts/ui";
import { getFeatureAccess } from "@/industries/_loader";
import { FEATURES } from "@/industries/_registry";
import type { Industry, TenantEntity } from "@/types/database";

export default async function ContactsRoutePage() {
  const tenantData = await getCurrentUserTenant();
  if (!tenantData) redirect("/login");
  if (!getFeatureAccess(tenantData.tenant.industry_id, FEATURES.CONTACTS)) notFound();

  const supabase = await createServiceClient();

  const leads = await getLeads(tenantData.tenant.id, {
    role: tenantData.role,
    userId: tenantData.userId,
  });

  const { data: teamData } = await supabase
    .from("tenant_users")
    .select("user_id, role")
    .eq("tenant_id", tenantData.tenant.id);

  const memberMap: Record<string, string> = {};
  const teamMembers: { user_id: string; email: string; role: string }[] = [];

  if (teamData) {
    const { data: { users } } = await supabase.auth.admin.listUsers();
    const userMap = new Map(users.map((u) => [u.id, u.email || ""]));
    for (const m of teamData) {
      const email = userMap.get(m.user_id) || "";
      memberMap[m.user_id] = email;
      teamMembers.push({ user_id: m.user_id, email, role: m.role });
    }
  }

  const { data: stagesData } = await supabase
    .from("pipeline_stages")
    .select("*")
    .eq("tenant_id", tenantData.tenant.id)
    .order("position");

  const { data: formConfigs } = await supabase
    .from("form_configs")
    .select("id, name")
    .eq("tenant_id", tenantData.tenant.id);

  const formMap: Record<string, string> = {};
  (formConfigs || []).forEach((f) => { formMap[f.id] = f.name; });

  const [industryResult, entitiesResult] = await Promise.all([
    tenantData.tenant.industry_id
      ? supabase.from("industries").select("*").eq("id", tenantData.tenant.industry_id).single()
      : Promise.resolve({ data: null }),
    supabase.from("tenant_entities").select("*").eq("tenant_id", tenantData.tenant.id).order("position"),
  ]);

  const industry = industryResult.data as Industry | null;
  const entities = (entitiesResult.data || []) as TenantEntity[];

  return (
    <ContactsPage
      leads={leads}
      memberMap={memberMap}
      stages={stagesData || []}
      formMap={formMap}
      role={tenantData.role as "owner" | "admin" | "viewer" | "counselor"}
      tenantId={tenantData.tenant.id}
      teamMembers={teamMembers}
      entities={entities}
      entityLabel={industry?.entity_type_label}
      currentUserId={tenantData.userId}
      industryId={tenantData.tenant.industry_id}
    />
  );
}
