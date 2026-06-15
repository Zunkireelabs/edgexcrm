import { type NextRequest } from "next/server";
import { authenticateRequest, requireAdmin } from "@/lib/api/auth";
import { apiSuccess, apiUnauthorized, apiForbidden, apiError, apiNotFound } from "@/lib/api/response";
import { scopedClient } from "@/lib/supabase/scoped";
import { getFeatureAccess } from "@/industries/_loader";
import { FEATURES } from "@/industries/_registry";
import { refreshEspnResults } from "@/industries/education-consultancy/features/campaigns/lib/results-espn";
import type { CampaignConfig } from "@/industries/education-consultancy/features/campaigns/lib/scoring";
import type { LeadSubmission } from "@/types/database";

interface CampaignRow {
  id: string;
  form_config_id: string | null;
  config: CampaignConfig;
}

export async function POST(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  const auth = await authenticateRequest();
  if (!auth) return apiUnauthorized();
  if (!getFeatureAccess(auth.industryId, FEATURES.CAMPAIGNS)) return apiForbidden();
  if (!requireAdmin(auth)) return apiForbidden();

  const db = await scopedClient(auth);

  const { data: campaignData, error: campaignError } = await db
    .from("campaigns")
    .select("id, form_config_id, config")
    .eq("id", id)
    .maybeSingle();

  if (campaignError) return apiError("DB_ERROR", "Failed to fetch campaign", 500);
  if (!campaignData) return apiNotFound("Campaign not found");

  const campaign = campaignData as unknown as CampaignRow;
  if (!campaign.form_config_id) {
    return apiSuccess({ refreshed: 0 });
  }

  const config = campaign.config;
  const matchIdField = config.fields?.match_id ?? "match_id";
  const matchLabelField = config.fields?.match_label ?? "match_label";

  // Load lead_submissions to get all match_ids
  const { data: subsRaw, error: subsError } = await db
    .from("lead_submissions")
    .select("custom_fields")
    .eq("form_config_id", campaign.form_config_id);

  if (subsError) return apiError("DB_ERROR", "Failed to fetch submissions", 500);
  const subs = (subsRaw ?? []) as unknown as Pick<LeadSubmission, "custom_fields">[];

  const matchIds = new Set<string>();
  const matchLabels: Record<string, string> = {};
  for (const sub of subs) {
    const matchId = String(sub.custom_fields?.[matchIdField] ?? "").trim();
    if (matchId.startsWith("espn-")) {
      matchIds.add(matchId);
      const label = String(sub.custom_fields?.[matchLabelField] ?? "").trim();
      if (label && !matchLabels[matchId]) matchLabels[matchId] = label;
    }
  }

  const results = await refreshEspnResults(
    campaign.id,
    auth.tenantId,
    Array.from(matchIds),
    config,
    matchLabels
  );

  return apiSuccess({ refreshed: results.length });
}
