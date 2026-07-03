import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { createServiceClient } from "@/lib/supabase/server";
import { checkRateLimit, PUBLIC_READ_LIMIT } from "@/lib/api/rate-limit";
import { ProposalDocument } from "@/industries/it-agency/features/proposals/components/proposal-document";
import type { ProposalLineItem } from "@/types/database";

export const dynamic = "force-dynamic";

interface PageProps {
  params: Promise<{ token: string }>;
}

function getClientIpFromHeaders(h: Headers): string {
  const forwarded = h.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0].trim();
  return h.get("x-real-ip") || "unknown";
}

export default async function PublicProposalPage({ params }: PageProps) {
  const { token } = await params;
  const h = await headers();
  const ip = getClientIpFromHeaders(h);

  const rateResult = await checkRateLimit(`public_proposal:${ip}`, PUBLIC_READ_LIMIT);
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
    .from("proposals")
    .select("*, deals!proposals_deal_id_fkey(name), proposal_line_items(*)")
    .eq("public_token", token)
    .eq("public_enabled", true)
    .is("deleted_at", null)
    .maybeSingle();

  // Generic not-found — never distinguish wrong token / disabled / deleted.
  if (!data) notFound();

  const row = data as unknown as {
    tenant_id: string;
    proposal_number: string;
    title: string;
    status: string;
    currency: string;
    subtotal: number;
    discount_type: "percent" | "amount" | null;
    discount_value: number;
    tax_percent: number;
    total: number;
    notes: string | null;
    valid_until: string | null;
    deals: { name: string } | null;
    proposal_line_items: ProposalLineItem[];
  };

  const { data: tenantData } = await svc
    .from("tenants")
    .select("name, logo_url, primary_color")
    .eq("id", row.tenant_id)
    .single();

  const branding = tenantData as { name: string; logo_url: string | null; primary_color: string | null } | null;

  const lineItems = [...(row.proposal_line_items ?? [])].sort((a, b) => {
    if (a.sort_order !== b.sort_order) return a.sort_order - b.sort_order;
    return a.created_at.localeCompare(b.created_at);
  });

  const expired = !!row.valid_until && new Date(row.valid_until) < new Date();

  return (
    <div className="min-h-screen bg-gray-50">
      <ProposalDocument
        proposal={{
          proposal_number: row.proposal_number,
          title: row.title,
          status: row.status,
          currency: row.currency,
          subtotal: row.subtotal,
          discount_type: row.discount_type,
          discount_value: row.discount_value,
          tax_percent: row.tax_percent,
          total: row.total,
          notes: row.notes,
          valid_until: row.valid_until,
          deal_name: row.deals?.name ?? null,
        }}
        lineItems={lineItems}
        branding={branding ? { name: branding.name, logo_url: branding.logo_url, primary_color: branding.primary_color } : null}
        expired={expired}
      />
    </div>
  );
}
