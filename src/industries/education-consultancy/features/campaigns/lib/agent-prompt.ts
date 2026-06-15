// ⚠️  Keep in sync with the public response shape in src/app/api/public/campaigns/[token]/leaderboard/route.ts

export function buildAgentPrompt({ url, campaignName }: { url: string; campaignName: string }): string {
  return `You are integrating a public, read-only prediction leaderboard into a website.

API (no auth, CORS-enabled, browser-safe):
GET ${url}
Optional: ?limit=N (max 500). Responses cached ~60s — poll at most once/min.

Response JSON:
{ "data": {
  "campaign": { "name": string, "status": "active"|"final" },
  "updated_at": string|null,   // ISO; when results were last refreshed (may lag live matches)
  "standings": [ { "rank": number, "name": string, "correct": number, "scored": number, "pct": number } ],
  "results":   [ { "match_label": string, "score": string|null, "outcome": "team_a"|"team_b"|"draw"|null, "status": "final"|"scheduled" } ],
  "pending_matches": [ { "match_id": string, "match_label": string } ]
}}

Semantics:
- standings are pre-sorted best->worst by \`correct\`, tie-broken by accuracy. \`name\` is already
  privacy-masked (first name + last initial) - there is NO email/phone. \`scored\` = finished
  matches counted; \`pct\` = accuracy %.
- results: \`outcome\` team_a/team_b = first/second team in \`match_label\`; \`score\` like "2–0" or null.
- pending_matches non-empty => standings NOT final yet.

Task: build a responsive "${campaignName}" leaderboard - standings table (rank, name,
correct/scored, %), top-3 emphasized; a results list; a "pending matches" banner; a "last
updated" stamp from updated_at. Handle loading/empty/error states. Re-fetch every 60s. Don't
assume fields beyond the above.`;
}
