import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { createServiceClient } from "@/lib/supabase/server";
import { checkRateLimit, PUBLIC_READ_LIMIT } from "@/lib/api/rate-limit";
import { PublicStatusReport } from "@/industries/it-agency/features/project-board/components/public-status-report";

export const dynamic = "force-dynamic";
export const metadata = { robots: { index: false, follow: false } };

interface PageProps {
  params: Promise<{ token: string }>;
}

function getClientIpFromHeaders(h: Headers): string {
  const forwarded = h.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0].trim();
  return h.get("x-real-ip") || "unknown";
}

export default async function PublicStatusReportPage({ params }: PageProps) {
  const { token } = await params;
  const h = await headers();
  const ip = getClientIpFromHeaders(h);

  const rateResult = await checkRateLimit(`public_status_report:${ip}`, PUBLIC_READ_LIMIT);
  if (!rateResult.allowed) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-50 px-4">
        <div className="max-w-md w-full bg-white rounded-xl shadow-sm border p-8 text-center space-y-4">
          <h1 className="text-lg font-semibold text-gray-900">Too many requests</h1>
          <p className="text-sm text-gray-600">Please try again in a moment.</p>
        </div>
      </div>
    );
  }

  const svc = await createServiceClient();
  const { data } = await svc
    .from("project_status_reports")
    .select("*")
    .eq("public_token", token)
    .eq("is_client_visible", true)
    .not("published_at", "is", null)
    .maybeSingle();

  // Generic not-found — never distinguish wrong token / disabled / draft.
  if (!data) notFound();

  const row = data as unknown as {
    tenant_id: string;
    project_id: string;
    report_date: string;
    health_snapshot: "green" | "amber" | "red" | null;
    pct_complete_snapshot: number | null;
    summary: string | null;
    accomplishments: string | null;
    in_progress: string | null;
    risks: string | null;
    asks: string | null;
    client_message: string | null;
  };

  const [{ data: project }, { data: tenantData }] = await Promise.all([
    svc.from("projects").select("name").eq("id", row.project_id).maybeSingle(),
    svc.from("tenants").select("name, logo_url, primary_color").eq("id", row.tenant_id).maybeSingle(),
  ]);

  const branding = tenantData as { name: string; logo_url: string | null; primary_color: string | null } | null;

  return (
    <div className="min-h-screen bg-gray-50">
      <PublicStatusReport
        report={{
          project_name: (project as { name: string } | null)?.name ?? "Project",
          report_date: row.report_date,
          health_snapshot: row.health_snapshot,
          pct_complete_snapshot: row.pct_complete_snapshot,
          summary: row.summary,
          accomplishments: row.accomplishments,
          in_progress: row.in_progress,
          risks: row.risks,
          asks: row.asks,
          client_message: row.client_message,
        }}
        branding={branding}
      />
    </div>
  );
}
