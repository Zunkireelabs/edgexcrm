import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import { getCurrentUserTenant } from "@/lib/supabase/queries";
import { createClient } from "@/lib/supabase/server";
import { getFeatureAccess } from "@/industries/_loader";
import { FEATURES } from "@/industries/_registry";
import { formatMoney } from "@/lib/travel/currency";
import { tripTypeLabel } from "@/industries/travel-agency/leads/trip-types";
import { Button } from "@/components/ui/button";

type Cf = Record<string, unknown>;

function str(v: unknown): string | null {
  return v == null || v === "" ? null : String(v);
}
function num(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}
function computeNights(start: unknown, end: unknown): number | null {
  const s = str(start);
  const e = str(end);
  if (!s || !e) return null;
  const diff = new Date(e).getTime() - new Date(s).getTime();
  const nights = Math.round(diff / 86_400_000);
  return nights > 0 ? nights : null;
}

interface ItineraryRow {
  id: string;
  name: string;
  destination: string;
  nights: number | null;
  tripType: string | null;
  currency: string;
  total: number;
  stageName: string | null;
  stageColor: string | null;
}

export default async function ItinerariesPage() {
  const tenantData = await getCurrentUserTenant();
  if (!tenantData) redirect("/login");
  if (!getFeatureAccess(tenantData.tenant.industry_id, FEATURES.ITINERARY)) notFound();

  const supabase = await createClient();
  const { data: leads } = await supabase
    .from("leads")
    .select("id, first_name, last_name, email, custom_fields, updated_at, stage:pipeline_stages(name, color)")
    .eq("tenant_id", tenantData.tenant.id)
    .is("deleted_at", null)
    .order("updated_at", { ascending: false });

  const rows: ItineraryRow[] = (leads ?? [])
    .map((l): ItineraryRow | null => {
      const cf = (l.custom_fields ?? {}) as Cf;
      const itin = cf.itinerary as
        | { currency?: string; lineItems?: Array<{ qty?: unknown; unitPrice?: unknown }> }
        | undefined;
      if (!itin) return null;
      const items = Array.isArray(itin.lineItems) ? itin.lineItems : [];
      const total = items.reduce((sum, i) => sum + num(i.qty) * num(i.unitPrice), 0);
      const stageRaw = (l as { stage?: unknown }).stage;
      const stage = (Array.isArray(stageRaw) ? stageRaw[0] : stageRaw) as
        | { name?: string; color?: string }
        | undefined;
      return {
        id: l.id as string,
        name: [l.first_name, l.last_name].filter(Boolean).join(" ") || str(l.email) || "—",
        destination: str(cf.trip_destination) ?? "—",
        nights: computeNights(cf.trip_start_date, cf.trip_end_date),
        tripType: cf.trip_type ? tripTypeLabel(String(cf.trip_type)) ?? String(cf.trip_type) : null,
        currency: itin.currency || "NPR",
        total,
        stageName: stage?.name ?? null,
        stageColor: stage?.color ?? null,
      };
    })
    .filter((r): r is ItineraryRow => r !== null);

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Itineraries</h1>
          <p className="text-sm text-muted-foreground mt-0.5">
            {rows.length === 0
              ? "Quotes you build on a lead appear here."
              : `${rows.length} quote${rows.length === 1 ? "" : "s"} across your pipeline.`}
          </p>
        </div>
      </div>

      {rows.length === 0 ? (
        <div className="flex flex-col items-center justify-center min-h-[40vh] gap-4 text-center px-4 border border-dashed rounded-lg">
          <p className="text-muted-foreground max-w-sm">
            Open a lead and click the <strong>Itinerary</strong> tab to build a day-by-day quote
            for that traveller. It will show up here.
          </p>
          <Button asChild>
            <Link href="/leads">Go to Leads</Link>
          </Button>
        </div>
      ) : (
        <div className="border border-border rounded-lg bg-card overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left">
                <th className="px-4 py-2.5 font-medium text-muted-foreground">Traveller</th>
                <th className="px-4 py-2.5 font-medium text-muted-foreground">Destination</th>
                <th className="px-4 py-2.5 font-medium text-muted-foreground">Trip</th>
                <th className="px-4 py-2.5 font-medium text-muted-foreground">Stage</th>
                <th className="px-4 py-2.5 font-medium text-muted-foreground text-right">Quote total</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-b border-border last:border-0 hover:bg-muted/40 transition-colors">
                  <td className="px-4 py-3">
                    <Link href={`/leads/${r.id}`} className="font-medium text-primary hover:underline">
                      {r.name}
                    </Link>
                  </td>
                  <td className="px-4 py-3">{r.destination}</td>
                  <td className="px-4 py-3 text-muted-foreground">
                    {[r.nights ? `${r.nights}N` : null, r.tripType].filter(Boolean).join(" · ") || "—"}
                  </td>
                  <td className="px-4 py-3">
                    {r.stageName ? (
                      <span
                        className="inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium"
                        style={
                          r.stageColor
                            ? { backgroundColor: `${r.stageColor}20`, color: r.stageColor }
                            : undefined
                        }
                      >
                        {r.stageName}
                      </span>
                    ) : (
                      "—"
                    )}
                  </td>
                  <td className="px-4 py-3 text-right font-semibold">
                    {formatMoney(r.total, r.currency)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
