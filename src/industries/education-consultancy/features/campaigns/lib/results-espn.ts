import { createServiceClient } from "@/lib/supabase/server";
import { logger } from "@/lib/logger";
import type { CampaignConfig } from "./scoring";

const log = logger.child({ module: "campaigns:espn" });

export interface EspnResult {
  match_id: string;
  match_label: string;
  home_team: string | null;
  away_team: string | null;
  home_score: number | null;
  away_score: number | null;
  outcome: "team_a" | "team_b" | "draw" | null;
  status: "scheduled" | "final";
}

interface EspnCompetitor {
  homeAway?: "home" | "away";
  team?: { displayName?: string };
  score?: string;
}

interface EspnSummary {
  header?: {
    competitions?: Array<{
      status?: { type?: { completed?: boolean } };
      competitors?: EspnCompetitor[];
    }>;
  };
}

async function fetchOneMatch(
  league: string,
  eventId: string
): Promise<{ home_team: string; away_team: string; home_score: number | null; away_score: number | null; completed: boolean }> {
  const url = `https://site.api.espn.com/apis/site/v2/sports/soccer/${league}/summary?event=${eventId}`;
  const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
  if (!res.ok) throw new Error(`ESPN ${res.status} for event ${eventId}`);

  const json = (await res.json()) as EspnSummary;
  const comp = json.header?.competitions?.[0];
  if (!comp) throw new Error(`No competition data for event ${eventId}`);

  const completed = comp.status?.type?.completed === true;
  const home = comp.competitors?.find((c) => c.homeAway === "home");
  const away = comp.competitors?.find((c) => c.homeAway === "away");

  return {
    home_team: home?.team?.displayName ?? "",
    away_team: away?.team?.displayName ?? "",
    home_score: completed && home?.score != null ? parseInt(home.score, 10) : null,
    away_score: completed && away?.score != null ? parseInt(away.score, 10) : null,
    completed,
  };
}

function computeOutcome(
  home: number | null,
  away: number | null
): "team_a" | "team_b" | "draw" | null {
  if (home === null || away === null) return null;
  if (home > away) return "team_a";
  if (away > home) return "team_b";
  return "draw";
}

/**
 * Fetch ESPN results for the given match_ids, upsert non-locked rows into
 * campaign_results, and return the current stored results for the campaign.
 */
export async function refreshEspnResults(
  campaignId: string,
  tenantId: string,
  matchIds: string[],
  config: CampaignConfig,
  matchLabels: Record<string, string>
): Promise<EspnResult[]> {
  const supabase = await createServiceClient();
  const league = config.league ?? "fifa.world";

  // Find which match_ids are already locked (never overwrite those)
  const { data: lockedRows } = await supabase
    .from("campaign_results")
    .select("match_id")
    .eq("campaign_id", campaignId)
    .eq("locked", true);

  const lockedIds = new Set(((lockedRows ?? []) as Array<{ match_id: string }>).map((r) => r.match_id));
  const toFetch = matchIds.filter((id) => !lockedIds.has(id));

  if (toFetch.length > 0) {
    const rows: Array<Record<string, unknown>> = [];

    await Promise.all(
      toFetch.map(async (matchId) => {
        const eventId = matchId.replace(/^espn-/, "");
        try {
          const { home_team, away_team, home_score, away_score, completed } = await fetchOneMatch(league, eventId);
          const outcome = completed ? computeOutcome(home_score, away_score) : null;
          rows.push({
            campaign_id: campaignId,
            tenant_id: tenantId,
            match_id: matchId,
            match_label: matchLabels[matchId] ?? "",
            home_team,
            away_team,
            home_score,
            away_score,
            outcome,
            status: completed ? "final" : "scheduled",
            source: "espn",
            locked: completed,
            fetched_at: new Date().toISOString(),
          });
        } catch (err) {
          log.warn({ matchId, err }, "ESPN fetch failed — existing row unchanged");
        }
      })
    );

    if (rows.length > 0) {
      const { error } = await supabase
        .from("campaign_results")
        .upsert(rows, { onConflict: "campaign_id,match_id" });
      if (error) log.error({ error }, "Failed to upsert campaign_results");
    }
  }

  // Return all current results for this campaign
  const { data: allResults } = await supabase
    .from("campaign_results")
    .select("match_id, match_label, home_team, away_team, home_score, away_score, outcome, status")
    .eq("campaign_id", campaignId);

  return (allResults ?? []) as EspnResult[];
}
