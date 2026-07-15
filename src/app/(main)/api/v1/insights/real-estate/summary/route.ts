import { authenticateRequest } from "@/lib/api/auth";
import { apiSuccess, apiUnauthorized, apiForbidden, apiError } from "@/lib/api/response";
import { scopedClient } from "@/lib/supabase/scoped";
import { getFeatureAccess } from "@/industries/_loader";
import { FEATURES } from "@/industries/_registry";
import {
  FUNNEL_COLUMNS,
  equityRaised,
  type Offering,
  type InvestorCommitment,
} from "@/industries/real-estate/lib/commitments";

// Capital-Raise Dashboard summary (real_estate). One server round-trip that
// server-aggregates the whole GP landing screen in TypeScript over
// scopedClient(auth) queries — no RPC, no migration (data is tiny; mirrors the
// JS-aggregation shape of GET /api/v1/offerings). Read-only.
export async function GET() {
  const auth = await authenticateRequest();
  if (!auth) return apiUnauthorized();
  // Gate on OFFERINGS (enabled only for real_estate in its manifest) …
  if (!getFeatureAccess(auth.industryId, FEATURES.OFFERINGS)) return apiForbidden();
  // … plus a defense-in-depth industry check, mirroring deals-summary's
  // `!== "it_agency"` guard: these aggregations are real_estate-only.
  if (auth.industryId !== "real_estate") return apiForbidden();

  const db = await scopedClient(auth);

  const { data: offData, error: offErr } = await db
    .from("offerings")
    .select("id, name, target_raise, status, currency")
    .is("deleted_at", null)
    .order("created_at", { ascending: true });
  if (offErr) return apiError("DB_ERROR", "Failed to load offerings", 500);
  const offerings = (offData ?? []) as unknown as Pick<
    Offering,
    "id" | "name" | "target_raise" | "status" | "currency"
  >[];

  const { data: cmtData, error: cmtErr } = await db
    .from("investor_commitments")
    .select("offering_id, lead_id, status, amount")
    .is("deleted_at", null);
  if (cmtErr) return apiError("DB_ERROR", "Failed to load commitments", 500);
  const commitments = (cmtData ?? []) as unknown as Pick<
    InvestorCommitment,
    "offering_id" | "lead_id" | "status" | "amount"
  >[];

  // Group commitments per offering, reuse equityRaised() from commitments.ts.
  const byOffering = new Map<string, Pick<InvestorCommitment, "status" | "amount">[]>();
  for (const c of commitments) {
    const arr = byOffering.get(c.offering_id) ?? [];
    arr.push({ status: c.status, amount: c.amount });
    byOffering.set(c.offering_id, arr);
  }

  const perOffering = offerings.map((o) => {
    const rows = byOffering.get(o.id) ?? [];
    const raised = equityRaised(rows);
    const target = Number(o.target_raise ?? 0);
    return {
      id: o.id,
      name: o.name,
      status: o.status,
      raised,
      target,
      pct: target > 0 ? Math.round((raised / target) * 100) : 0,
    };
  });

  const ACTIVE = new Set(["raising", "funded", "paused"]);
  const totalRaised = perOffering.reduce((s, o) => s + o.raised, 0);
  const totalTarget = offerings
    .filter((o) => ACTIVE.has(o.status))
    .reduce((s, o) => s + Number(o.target_raise ?? 0), 0);
  const fundedTotal = commitments
    .filter((c) => c.status === "funded")
    .reduce((s, c) => s + Number(c.amount ?? 0), 0);

  const investorIds = new Set(
    commitments.filter((c) => c.status !== "declined").map((c) => c.lead_id),
  );
  const checks = commitments
    .filter((c) => (c.status === "subscribed" || c.status === "funded") && c.amount != null)
    .map((c) => Number(c.amount));
  const avgCheck = checks.length ? Math.round(checks.reduce((a, b) => a + b, 0) / checks.length) : 0;

  const funnel = FUNNEL_COLUMNS.map((status) => {
    const rows = commitments.filter((c) => c.status === status);
    return {
      status,
      count: rows.length,
      amount: rows.reduce((s, c) => s + Number(c.amount ?? 0), 0),
    };
  });

  const currency = offerings[0]?.currency ?? "USD";

  return apiSuccess({
    currency,
    totalRaised,
    totalTarget,
    pctRaised: totalTarget > 0 ? Math.round((totalRaised / totalTarget) * 100) : 0,
    fundedTotal,
    investorCount: investorIds.size,
    avgCheck,
    activeOfferings: offerings.filter((o) => ACTIVE.has(o.status)).length,
    offerings: perOffering,
    funnel,
  });
}
