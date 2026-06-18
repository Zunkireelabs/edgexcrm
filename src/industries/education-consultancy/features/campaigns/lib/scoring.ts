import { normalizeEmail } from "@/lib/leads/dedup";
import type { IntegrityFlag } from "./integrity";

export interface ScoringSubmission {
  email: string | null;
  normalized_email: string | null;
  first_name: string | null;
  last_name: string | null;
  phone: string | null;
  custom_fields: Record<string, unknown>;
  created_at: string;
}

export interface MatchResult {
  outcome: "team_a" | "team_b" | "draw" | null;
  status: "scheduled" | "final";
  match_label: string;
}

export interface CampaignConfig {
  provider?: string;
  league?: string;
  fields: {
    match_id: string;
    match_label: string;
    prediction: string;
  };
  outcomes: {
    team_a: string;
    team_b: string;
    draw: string;
  };
  exclude_domains?: string[];
  exclude_emails?: string[];
  leaderboard_fields?: { key: string; label: string }[];
}

export interface LeaderboardPick {
  match_id: string;
  match_label: string;
  prediction: string;
  outcome: "team_a" | "team_b" | "draw" | null;
  status: "scheduled" | "final";
  created_at: string;
}

export interface LeaderboardEntry {
  rank: number;
  name: string;
  email: string;
  phone: string | null;
  correct: number;
  scored: number;
  pct: number;
  picks: LeaderboardPick[];
  profile: Record<string, string | null>;
  flags?: IntegrityFlag[];
}

const VALID_MATCH_PREFIX = "espn-";

type RawPick = {
  normalizedEmail: string;
  firstName: string | null;
  lastName: string | null;
  phone: string | null;
  matchId: string;
  matchLabel: string;
  prediction: string;
  createdAt: string;
};

export function scoreSubmissions(
  submissions: ScoringSubmission[],
  results: Record<string, MatchResult>,
  config: CampaignConfig,
  profileFields: { key: string; label: string }[] = []
): LeaderboardEntry[] {
  const matchIdField = config.fields.match_id;
  const predictionField = config.fields.prediction;
  const matchLabelField = config.fields.match_label;
  const validOutcomes = new Set(Object.values(config.outcomes));
  const excludeDomains = new Set((config.exclude_domains ?? []).map((d) => d.toLowerCase()));
  const excludeEmails = new Set((config.exclude_emails ?? []).map((e) => e.toLowerCase()));

  // Step 1+2: Filter valid picks and dedup by (email, match_id) keeping latest
  const dedupMap = new Map<string, RawPick>();

  for (const sub of submissions) {
    const rawMatchId = String(sub.custom_fields[matchIdField] ?? "").trim();
    const prediction = String(sub.custom_fields[predictionField] ?? "").trim();
    const matchLabel = String(sub.custom_fields[matchLabelField] ?? "").trim();

    if (!rawMatchId.startsWith(VALID_MATCH_PREFIX)) continue;
    if (!validOutcomes.has(prediction)) continue;

    const normEmail = normalizeEmail(sub.email) ?? normalizeEmail(sub.normalized_email);
    if (!normEmail) continue;

    const key = `${normEmail}|${rawMatchId}`;
    const existing = dedupMap.get(key);
    if (!existing || sub.created_at > existing.createdAt) {
      dedupMap.set(key, {
        normalizedEmail: normEmail,
        firstName: sub.first_name,
        lastName: sub.last_name,
        phone: sub.phone,
        matchId: rawMatchId,
        matchLabel,
        prediction,
        createdAt: sub.created_at,
      });
    }
  }

  // Profile fields — latest non-empty value per person per key (across ALL submissions)
  const profileLatest = new Map<string, Record<string, { value: string; createdAt: string }>>();
  if (profileFields.length > 0) {
    for (const sub of submissions) {
      const normEmail = normalizeEmail(sub.email) ?? normalizeEmail(sub.normalized_email);
      if (!normEmail) continue;
      for (const { key } of profileFields) {
        const raw = sub.custom_fields[key];
        const value = raw != null ? String(raw).trim() : "";
        if (!value) continue;
        let personProfile = profileLatest.get(normEmail);
        if (!personProfile) {
          personProfile = {};
          profileLatest.set(normEmail, personProfile);
        }
        const existing = personProfile[key];
        if (!existing || sub.created_at > existing.createdAt) {
          personProfile[key] = { value, createdAt: sub.created_at };
        }
      }
    }
  }

  // Step 3: Group by email, building person records
  const people = new Map<
    string,
    { normalizedEmail: string; firstName: string | null; lastName: string | null; phone: string | null; picks: RawPick[] }
  >();

  for (const pick of dedupMap.values()) {
    let person = people.get(pick.normalizedEmail);
    if (!person) {
      person = {
        normalizedEmail: pick.normalizedEmail,
        firstName: pick.firstName,
        lastName: pick.lastName,
        phone: pick.phone,
        picks: [],
      };
      people.set(pick.normalizedEmail, person);
    }
    person.picks.push(pick);
  }

  // Step 4: Exclude test/internal + score each person
  const entries: Omit<LeaderboardEntry, "rank">[] = [];

  for (const person of people.values()) {
    const domain = person.normalizedEmail.split("@")[1] ?? "";
    if (excludeDomains.has(domain)) continue;
    if (excludeEmails.has(person.normalizedEmail)) continue;

    const fullName = [person.firstName, person.lastName].filter(Boolean).join(" ");
    // Drop "test%" names (case-insensitive)
    if (fullName.toLowerCase().startsWith("test")) continue;
    if ((person.firstName ?? "").toLowerCase().startsWith("test")) continue;

    const name = fullName || person.normalizedEmail;

    let correct = 0;
    let scored = 0;
    const picks: LeaderboardPick[] = [];

    for (const pick of person.picks) {
      const result = results[pick.matchId];
      if (!result) continue;

      if (result.status === "final" && result.outcome !== null) {
        scored++;
        if (pick.prediction === result.outcome) correct++;
      }

      picks.push({
        match_id: pick.matchId,
        match_label: pick.matchLabel || result.match_label,
        prediction: pick.prediction,
        outcome: result.outcome,
        status: result.status,
        created_at: pick.createdAt,
      });
    }

    const pct = scored > 0 ? Math.round((correct / scored) * 100) : 0;
    const profile: Record<string, string | null> = {};
    const personProfile = profileLatest.get(person.normalizedEmail);
    for (const { key } of profileFields) {
      profile[key] = personProfile?.[key]?.value ?? null;
    }
    entries.push({ name, email: person.normalizedEmail, phone: person.phone, correct, scored, pct, picks, profile });
  }

  // Step 5: Rank — most correct desc, accuracy desc, name asc
  entries.sort((a, b) => {
    if (b.correct !== a.correct) return b.correct - a.correct;
    if (b.pct !== a.pct) return b.pct - a.pct;
    return a.name.localeCompare(b.name);
  });

  return entries.map((e, i) => ({ ...e, rank: i + 1 }));
}

/**
 * Per-match auto-winner. Final matches only. Eligible = predicted correctly AND
 * study_abroad_interest === "yes". Tie → earliest submission, then name A→Z.
 * Returns Map<match_id, winnerEmail>. Matches with no eligible predictor are absent.
 */
export function pickMatchWinners(
  entries: LeaderboardEntry[],
  results: Record<string, MatchResult>
): Map<string, string> {
  const candidates = new Map<string, Array<{ email: string; name: string; created_at: string }>>();

  for (const entry of entries) {
    if (entry.profile["study_abroad_interest"] !== "yes") continue;
    for (const pick of entry.picks) {
      const result = results[pick.match_id];
      if (!result || result.status !== "final" || result.outcome === null) continue;
      if (pick.prediction !== result.outcome) continue;
      if (!candidates.has(pick.match_id)) candidates.set(pick.match_id, []);
      candidates.get(pick.match_id)!.push({ email: entry.email, name: entry.name, created_at: pick.created_at });
    }
  }

  const winners = new Map<string, string>();
  for (const [matchId, list] of candidates) {
    list.sort((a, b) => {
      const timeDiff = a.created_at.localeCompare(b.created_at);
      if (timeDiff !== 0) return timeDiff;
      return a.name.localeCompare(b.name);
    });
    winners.set(matchId, list[0].email);
  }
  return winners;
}
