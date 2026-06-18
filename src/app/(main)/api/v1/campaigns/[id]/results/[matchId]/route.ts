import { type NextRequest } from "next/server";
import { authenticateRequest, requireAdmin } from "@/lib/api/auth";
import { apiSuccess, apiUnauthorized, apiForbidden, apiError, apiNotFound, apiValidationError } from "@/lib/api/response";
import { scopedClient } from "@/lib/supabase/scoped";
import { getFeatureAccess } from "@/industries/_loader";
import { FEATURES } from "@/industries/_registry";
import { normalizeEmail } from "@/lib/leads/dedup";
import type { CampaignConfig } from "@/industries/education-consultancy/features/campaigns/lib/scoring";

const VALID_OUTCOMES = new Set(["team_a", "team_b", "draw"]);

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string; matchId: string }> }
) {
  const { id, matchId } = await params;

  const auth = await authenticateRequest();
  if (!auth) return apiUnauthorized();
  if (!getFeatureAccess(auth.industryId, FEATURES.CAMPAIGNS)) return apiForbidden();
  if (!requireAdmin(auth)) return apiForbidden();

  let body: {
    revert?: boolean;
    outcome?: string;
    home_score?: number | null;
    away_score?: number | null;
    set_winner?: string | null;
  };
  try {
    body = await request.json();
  } catch {
    return apiValidationError({ body: ["Invalid JSON"] });
  }

  const db = await scopedClient(auth);

  // Verify campaign belongs to this tenant (also fetch form_config_id + config for set_winner validation)
  const { data: campaign, error: campaignError } = await db
    .from("campaigns")
    .select("id, form_config_id, config")
    .eq("id", id)
    .maybeSingle();

  if (campaignError) return apiError("DB_ERROR", "Failed to fetch campaign", 500);
  if (!campaign) return apiNotFound("Campaign not found");

  const campaignRow = campaign as unknown as { id: string; form_config_id: string | null; config: CampaignConfig };

  let patch: Record<string, unknown>;

  if ("set_winner" in body) {
    // --- Winner override branch ---
    const rawEmail = body.set_winner;
    if (rawEmail === null) {
      patch = { winner_email: null };
    } else {
      const normalizedInput = normalizeEmail(rawEmail as string);
      if (!normalizedInput) {
        return apiValidationError({ set_winner: ["Invalid email"] });
      }

      if (!campaignRow.form_config_id) {
        return apiValidationError({ set_winner: ["Campaign has no form configured"] });
      }

      const config = campaignRow.config;
      const matchIdField = config.fields?.match_id ?? "match_id";
      const predictionField = config.fields?.prediction ?? "prediction";
      const validOutcomes = new Set(Object.values(config.outcomes ?? {}));

      const { data: subsRaw } = await db
        .from("lead_submissions")
        .select("email, normalized_email, custom_fields")
        .eq("form_config_id", campaignRow.form_config_id);

      const subs = (subsRaw ?? []) as unknown as Array<{
        email: string | null;
        normalized_email: string | null;
        custom_fields: Record<string, unknown>;
      }>;

      const isPredictor = subs.some((sub) => {
        const matchIdVal = String(sub.custom_fields?.[matchIdField] ?? "").trim();
        if (matchIdVal !== matchId) return false;
        if (!matchIdVal.startsWith("espn-")) return false;
        const prediction = String(sub.custom_fields?.[predictionField] ?? "").trim();
        if (!validOutcomes.has(prediction)) return false;
        const normEmail = normalizeEmail(sub.email) ?? normalizeEmail(sub.normalized_email);
        return normEmail === normalizedInput;
      });

      if (!isPredictor) {
        return apiValidationError({ set_winner: ["Not a predictor of this match"] });
      }

      patch = { winner_email: normalizedInput };
    }
  } else if (body.revert === true) {
    patch = { source: "espn", locked: false };
  } else {
    if (!body.outcome || !VALID_OUTCOMES.has(body.outcome)) {
      return apiValidationError({ outcome: ['Must be one of "team_a", "team_b", "draw"'] });
    }
    if (body.home_score !== undefined && body.home_score !== null) {
      if (!Number.isInteger(body.home_score) || body.home_score < 0) {
        return apiValidationError({ home_score: ["Must be an integer >= 0 or null"] });
      }
    }
    if (body.away_score !== undefined && body.away_score !== null) {
      if (!Number.isInteger(body.away_score) || body.away_score < 0) {
        return apiValidationError({ away_score: ["Must be an integer >= 0 or null"] });
      }
    }
    patch = {
      outcome: body.outcome,
      home_score: body.home_score ?? null,
      away_score: body.away_score ?? null,
      status: "final",
      source: "manual",
      locked: true,
      fetched_at: new Date().toISOString(),
    };
  }

  const { data: updated, error: updateError } = await db
    .from("campaign_results")
    .update(patch)
    .eq("campaign_id", id)
    .eq("match_id", matchId)
    .select("match_id, match_label, home_team, away_team, home_score, away_score, outcome, status, source, locked, fetched_at, winner_email");

  if (updateError) return apiError("DB_ERROR", "Failed to update result", 500);
  const rows = updated as unknown[];
  if (!rows || rows.length === 0) {
    return apiNotFound("Match result not found — refresh results first");
  }

  return apiSuccess(rows[0]);
}
