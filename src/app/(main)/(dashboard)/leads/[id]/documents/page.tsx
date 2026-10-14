import Link from "next/link";
import { redirect, notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { getCurrentUserTenant, getLead } from "@/lib/supabase/queries";
import { canSeeNav, leadQueryScope } from "@/lib/api/permissions";
import { getFeatureAccess } from "@/industries/_loader";
import { FEATURES } from "@/industries/_registry";
import { ApplicantDocumentsCard } from "@/industries/education-consultancy/features/applicant-documents/documents-card";

// Thin route shell: auth + feature gate + the same lead-visibility scope as the lead page, then
// hands off to the documents UI in the education-consultancy feature folder.
export default async function LeadDocumentsPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const tenantData = await getCurrentUserTenant();
  if (!tenantData) redirect("/login");
  if (!canSeeNav(tenantData.permissions, "/leads")) redirect("/dashboard");
  if (!getFeatureAccess(tenantData.tenant.industry_id, FEATURES.APPLICANT_DOCUMENTS)) notFound();

  const lead = await getLead(
    id,
    tenantData.tenant.id,
    leadQueryScope(tenantData.permissions, tenantData.userId, tenantData.branchId),
  );
  if (!lead) notFound();

  const isAdmin = tenantData.role === "owner" || tenantData.role === "admin";
  const name = [lead.first_name, lead.last_name].filter(Boolean).join(" ") || "Student";

  return (
    <div className="w-full px-4 py-6 space-y-4">
      <Link
        href={`/leads/${lead.id}`}
        className="inline-flex items-center text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4 mr-1.5" />
        Back to {name}
      </Link>
      <h1 className="text-lg font-semibold">Documents · {name}</h1>
      <ApplicantDocumentsCard
        leadId={lead.id}
        canManage={isAdmin || tenantData.permissions.canEditLeads}
        currentUserId={tenantData.userId}
        isAdmin={isAdmin}
      />
    </div>
  );
}
