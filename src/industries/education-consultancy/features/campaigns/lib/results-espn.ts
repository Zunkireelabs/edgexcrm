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
  source: "espn" | "manual";
  locked: boolean;
  match_date: string | null;
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
      date?: string;
    }>;
  };
}

async function fetchOneMatch(
  league: string,
  eventId: string
): Promise<{ home_team: string; away_team: string; home_score: number | null; away_score: number | null; completed: boolean; date: string | null }> {
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
    date: comp.date ?? null,
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

  // Load existing rows — locked + date present = fully immutable; locked + null date = date-only backfill
  const { data: existingRows, error: existingErr } = await supabase
    .from("campaign_results")
    .select("match_id, locked, match_date")
    .eq("campaign_id", campaignId);
  if (existingErr) log.warn({ error: existingErr }, "Failed to load existing campaign_results — refresh may re-fetch");

  type ExistingRow = { match_id: string; locked: boolean; match_date: string | null };
  const existingMap = new Map(
    ((existingRows ?? []) as ExistingRow[]).map((r) => [r.match_id, r])
  );

  // Fetch unlocked rows, AND locked rows missing match_date (date-only backfill)
  const toFetch = matchIds.filter((id) => {
    const row = existingMap.get(id);
    if (!row) return true;
    if (!row.locked) return true;
    return row.match_date === null;
  });

  if (toFetch.length > 0) {
    const rows: Array<Record<string, unknown>> = [];

    await Promise.all(
      toFetch.map(async (matchId) => {
        const isLockedBackfill = existingMap.get(matchId)?.locked === true;
        const eventId = matchId.replace(/^espn-/, "");
        try {
          const { home_team, away_team, home_score, away_score, completed, date } = await fetchOneMatch(league, eventId);

          if (isLockedBackfill) {
            // Only write match_date — never touch scores/outcome/locked/source
            if (date) {
              const { error: dateErr } = await supabase
                .from("campaign_results")
                .update({ match_date: date })
                .eq("campaign_id", campaignId)
                .eq("match_id", matchId);
              if (dateErr) log.warn({ matchId, dateErr }, "Failed to backfill match_date");
            }
          } else {
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
              match_date: date,
              fetched_at: new Date().toISOString(),
            });
          }
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
  const { data: allResults, error: allResultsErr } = await supabase
    .from("campaign_results")
    .select("match_id, match_label, home_team, away_team, home_score, away_score, outcome, status, source, locked, match_date")
    .eq("campaign_id", campaignId);
  if (allResultsErr) log.error({ error: allResultsErr }, "Failed to load campaign_results");

  return (allResults ?? []) as EspnResult[];
}
