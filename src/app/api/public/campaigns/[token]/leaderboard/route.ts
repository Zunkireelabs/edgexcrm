// Public leaderboard — no auth required. Freshness is tied to admin "Refresh results";
// no ESPN fetch here (keeps this path fast and abuse-proof).
import { NextRequest, NextResponse } from "next/server";
import { createServiceClient } from "@/lib/supabase/server";
import { getClientIp } from "@/lib/api/auth";
import { checkRateLimit, PUBLIC_READ_LIMIT } from "@/lib/api/rate-limit";
import { apiRateLimited } from "@/lib/api/response";
import { scoreSubmissions } from "@/industries/education-consultancy/features/campaigns/lib/scoring";
import type { CampaignConfig, MatchResult } from "@/industries/education-consultancy/features/campaigns/lib/scoring";
import type { LeadSubmission } from "@/types/database";

const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
};

export function OPTIONS() {
  return new NextResponse(null, { status: 200, headers: CORS_HEADERS });
}

function maskName(rawName: string): string {
  if (!rawName || rawName.includes("@")) return "Participant";
  const parts = rawName.trim().split(/\s+/);
  if (parts.length === 1) return parts[0];
  return `${parts[0]} ${parts[parts.length - 1][0]}.`;
}

function notFound() {
  return NextResponse.json({ error: { code: "NOT_FOUND", message: "Not found" } }, {
    status: 404,
    headers: CORS_HEADERS,
  });
}

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params;
  const ip = getClientIp(request);

  const rateResult = await checkRateLimit(`public_leaderboard:${ip}`, PUBLIC_READ_LIMIT);
  if (!rateResult.allowed) {
    const res = apiRateLimited(rateResult.retryAfterSeconds);
    for (const [k, v] of Object.entries(CORS_HEADERS)) res.headers.set(k, v);
    return res;
  }

  const supabase = await createServiceClient();

  // Look up campaign by token — 404 if not found OR public_enabled is false
  const { data: campaignData } = await supabase
    .from("campaigns")
    .select("id, name, status, form_config_id, config, updated_at, public_enabled")
    .eq("public_token", token)
    .eq("public_enabled", true)
    .maybeSingle();

  if (!campaignData) return notFound();

  const campaign = campaignData as unknown as {
    id: string;
    name: string;
    status: string;
    form_config_id: string | null;
    config: CampaignConfig;
    updated_at: string;
    public_enabled: boolean;
  };

  const { limit: limitParam } = Object.fromEntries(request.nextUrl.searchParams);
  const cap = Math.min(parseInt(limitParam ?? "500", 10) || 500, 500);

  if (!campaign.form_config_id) {
    return NextResponse.json({
      data: { campaign: { name: campaign.name, status: campaign.status }, updated_at: null, standings: [], results: [], pending_matches: [] },
    }, { status: 200, headers: { ...CORS_HEADERS, "Cache-Control": "public, s-maxage=60, stale-while-revalidate=300" } });
  }

  // Load stored results — DO NOT call ESPN
  const { data: storedResults } = await supabase
    .from("campaign_results")
    .select("match_id, match_label, home_score, away_score, outcome, status, fetched_at")
    .eq("campaign_id", campaign.id);

  const results = (storedResults ?? []) as Array<{
    match_id: string;
    match_label: string;
    home_score: number | null;
    away_score: number | null;
    outcome: "team_a" | "team_b" | "draw" | null;
    status: "scheduled" | "final";
    fetched_at: string;
  }>;

  // Build results map for scoring
  const resultsMap: Record<string, MatchResult> = {};
  for (const r of results) {
    resultsMap[r.match_id] = {
      outcome: r.outcome,
      status: r.status,
      match_label: r.match_label,
    };
  }

  // Load submissions
  const { data: subsRaw } = await supabase
    .from("lead_submissions")
    .select("email, normalized_email, first_name, last_name, phone, custom_fields, created_at")
    .eq("form_config_id", campaign.form_config_id);

  const submissions = (subsRaw ?? []) as unknown as LeadSubmission[];

  const standings = scoreSubmissions(submissions, resultsMap, campaign.config);

  // Mask PII before returning
  const maskedStandings = standings.slice(0, cap).map(({ rank, name, correct, scored, pct }) => ({
    rank,
    name: maskName(name),
    correct,
    scored,
    pct,
  }));

  const pending_matches = results
    .filter((r) => r.status === "scheduled")
    .map((r) => ({ match_id: r.match_id, match_label: r.match_label }));

  const publicResults = results.map((r) => ({
    match_label: r.match_label,
    score: r.status === "final" && r.home_score != null ? `${r.home_score}–${r.away_score}` : null,
    outcome: r.outcome,
    status: r.status,
  }));

  const updated_at = results.length > 0
    ? results.reduce((max, r) => (r.fetched_at > max ? r.fetched_at : max), results[0].fetched_at)
    : null;

  return NextResponse.json(
    {
      data: {
        campaign: { name: campaign.name, status: campaign.status },
        updated_at,
        standings: maskedStandings,
        results: publicResults,
        pending_matches,
      },
    },
    {
      status: 200,
      headers: {
        ...CORS_HEADERS,
        "Cache-Control": "public, s-maxage=60, stale-while-revalidate=300",
      },
    }
  );
}
