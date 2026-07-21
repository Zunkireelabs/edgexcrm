import { type NextRequest } from "next/server";
import { authenticateRequest, requireAdmin } from "@/lib/api/auth";
import { apiSuccess, apiUnauthorized, apiForbidden, apiError, apiNotFound } from "@/lib/api/response";
import { scopedClient } from "@/lib/supabase/scoped";
import { getFeatureAccess } from "@/industries/_loader";
import { FEATURES } from "@/industries/_registry";
import { refreshEspnResults } from "@/industries/education-consultancy/features/campaigns/lib/results-espn";
import { scoreSubmissions } from "@/industries/education-consultancy/features/campaigns/lib/scoring";
import type { CampaignConfig, MatchResult } from "@/industries/education-consultancy/features/campaigns/lib/scoring";
import { annotateIntegrity } from "@/industries/education-consultancy/features/campaigns/lib/integrity";
import { DEFAULT_LEADERBOARD_FIELDS } from "@/industries/education-consultancy/features/campaigns/lib/constants";
import { fetchAllSubmissions } from "@/industries/education-consultancy/features/campaigns/lib/fetch-submissions";
import { logger } from "@/lib/logger";
import type { LeadSubmission } from "@/types/database";

const log = logger.child({ module: "campaigns:leaderboard" });

interface CampaignRow {
  id: string;
  name: string;
  slug: string;
  type: string;
  status: string;
  form_config_id: string | null;
  config: CampaignConfig;
  created_at: string;
  updated_at: string;
  public_enabled: boolean;
  public_token: string | null;
}

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  const auth = await authenticateRequest();
  if (!auth) return apiUnauthorized();
  if (!getFeatureAccess(auth.industryId, FEATURES.CAMPAIGNS)) return apiForbidden();
  if (!requireAdmin(auth)) return apiForbidden();

  const db = await scopedClient(auth);

  // Load campaign (scoped to tenant)
  const { data: campaignData, error: campaignError } = await db
    .from("campaigns")
    .select("id, name, slug, type, status, form_config_id, config, created_at, updated_at, public_enabled, public_token")
    .eq("id", id)
    .maybeSingle();

  if (campaignError) return apiError("DB_ERROR", "Failed to fetch campaign", 500);
  if (!campaignData) return apiNotFound("Campaign not found");

  const campaign = campaignData as unknown as CampaignRow;
  if (!campaign.form_config_id) {
    return apiSuccess({
      campaign,
      standings: [],
      results: [],
      pending_matches: [],
    });
  }

  const config = campaign.config;
  const matchIdField = config.fields?.match_id ?? "match_id";
  const matchLabelField = config.fields?.match_label ?? "match_label";

  // Load lead_submissions for this form — paginated, a campaign can have
  // more than the default 1000-row PostgREST cap (see fetch-submissions.ts).
  let submissions: LeadSubmission[];
  try {
    submissions = await fetchAllSubmissions<LeadSubmission>(
      db,
      campaign.form_config_id,
      "email, normalized_email, first_name, last_name, phone, custom_fields, created_at"
    );
  } catch (err) {
    log.error({ err, campaignId: campaign.id }, "Failed to fetch campaign submissions");
    return apiError("DB_ERROR", "Failed to fetch submissions", 500);
  }

  // Extract distinct match_ids and match labels from submissions
  const matchIds = new Set<string>();
  const matchLabels: Record<string, string> = {};
  for (const sub of submissions) {
    const matchId = String(sub.custom_fields?.[matchIdField] ?? "").trim();
    if (matchId.startsWith("espn-")) {
      matchIds.add(matchId);
      const label = String(sub.custom_fields?.[matchLabelField] ?? "").trim();
      if (label && !matchLabels[matchId]) matchLabels[matchId] = label;
    }
  }

  // Refresh ESPN results (upserts non-locked rows)
  const espnResults = await refreshEspnResults(
    campaign.id,
    auth.tenantId,
    Array.from(matchIds),
    config,
    matchLabels
  );

  // Build results map for scoring
  const resultsMap: Record<string, MatchResult> = {};
  for (const r of espnResults) {
    resultsMap[r.match_id] = {
      outcome: r.outcome as "team_a" | "team_b" | "draw" | null,
      status: r.status as "scheduled" | "final",
      match_label: r.match_label,
    };
  }

  // Run scoring engine with profile fields
  const leaderboardFields = config.leaderboard_fields ?? DEFAULT_LEADERBOARD_FIELDS;
  const standings = annotateIntegrity(scoreSubmissions(submissions, resultsMap, config, leaderboardFields));

  // Winner is admin-assigned only — no auto-pick. Resolve the manual override
  // against standings (any leaderboard applicant, not just this match's predictors).
  const resultsWithWinners = espnResults.map((r) => {
    if (r.status !== "final" || !r.winner_email) return { ...r, winner: null };

    const resolvedEntry = standings.find((e) => e.email === r.winner_email);
    if (!resolvedEntry) return { ...r, winner: null };

    return {
      ...r,
      winner: { email: r.winner_email, name: resolvedEntry.name },
    };
  });

  // Pending matches = those still scheduled
  const pending_matches = espnResults
    .filter((r) => r.status === "scheduled")
    .map((r) => ({ match_id: r.match_id, match_label: r.match_label }));

  return apiSuccess({
    campaign,
    standings,
    results: resultsWithWinners,
    pending_matches,
    leaderboard_fields: leaderboardFields,
  });
}
