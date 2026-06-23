import { redirect } from "next/navigation";
import { getCurrentUserTenant, getLeadListsByTenant } from "@/lib/supabase/queries";
import { getFeatureAccess } from "@/industries/_loader";
import { FEATURES } from "@/industries/_registry";
import { canAccessList } from "@/lib/api/permissions";
import { createServiceClient } from "@/lib/supabase/server";
import type { LeadList } from "@/types/database";
import Link from "next/link";

export default async function LeadsOrganisePage() {
  const tenantData = await getCurrentUserTenant();
  if (!tenantData) redirect("/login");

  // Admin/manager only
  const isAdmin = tenantData.role === "owner" || tenantData.role === "admin";
  if (!isAdmin) redirect("/dashboard");

  const hasLeadLists = getFeatureAccess(tenantData.tenant.industry_id, FEATURES.LEAD_LISTS);
  if (!hasLeadLists) redirect("/dashboard");

  const allLists = await getLeadListsByTenant(tenantData.tenant.id);
  const stagingLists = (allLists as LeadList[]).filter(
    (l) => l.is_staging && canAccessList(
      tenantData.permissions,
      l.access as { mode: string; positionIds?: string[] },
      tenantData.positionId,
    )
  );

  if (stagingLists.length === 0) redirect("/leads");

  // Get lead counts for each staging list
  const supabase = await createServiceClient();
  const counts = await Promise.all(
    stagingLists.map(async (list) => {
      const { count } = await supabase
        .from("leads")
        .select("id", { count: "exact", head: true })
        .eq("tenant_id", tenantData.tenant.id)
        .eq("list_id", list.id)
        .is("deleted_at", null);
      return { id: list.id, count: count ?? 0 };
    })
  );
  const countMap = Object.fromEntries(counts.map((c) => [c.id, c.count]));

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-lg font-bold">Leads Organise</h1>
        <p className="text-sm text-muted-foreground mt-1">
          Staging lists where imported leads land. Route chunks into the live pipeline.
        </p>
      </div>

      <div className="grid gap-3">
        {stagingLists.map((list) => (
          <Link
            key={list.id}
            href={`/leads-organise/${list.slug}`}
            className="block border border-gray-200 rounded-lg p-4 bg-white hover:border-gray-300 hover:shadow-sm transition-all"
          >
            <div className="flex items-center justify-between">
              <div>
                <p className="font-medium text-gray-900">{list.name}</p>
                <p className="text-sm text-muted-foreground mt-0.5">
                  Staging list · {countMap[list.id] ?? 0} leads
                </p>
              </div>
              <span className="text-xs bg-amber-50 text-amber-700 border border-amber-200 rounded-full px-2.5 py-0.5 font-medium">
                Staging
              </span>
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}
