"use client";

import { useCallback, useEffect, useState } from "react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Checkbox } from "@/components/ui/checkbox";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { RefreshCw, AlertCircle, Lock, Trophy, Settings, Copy, Check, ChevronDown, ChevronRight } from "lucide-react";
import type { LeaderboardEntry } from "../lib/scoring";

interface EspnResult {
  match_id: string;
  match_label: string;
  home_team: string | null;
  away_team: string | null;
  home_score: number | null;
  away_score: number | null;
  outcome: "team_a" | "team_b" | "draw" | null;
  status: "scheduled" | "final";
  source?: "espn" | "manual";
  locked?: boolean;
}

interface Campaign {
  id: string;
  name: string;
  status: "draft" | "active" | "final";
  updated_at: string;
  public_enabled?: boolean;
  public_token?: string | null;
}

interface LeaderboardData {
  campaign: Campaign;
  standings: LeaderboardEntry[];
  results: EspnResult[];
  pending_matches: Array<{ match_id: string; match_label: string }>;
}

function outcomeLabel(outcome: string | null) {
  if (!outcome) return "—";
  if (outcome === "team_a") return "Home win";
  if (outcome === "team_b") return "Away win";
  return "Draw";
}

function predictionLabel(prediction: string) {
  if (prediction === "team_a") return "Home";
  if (prediction === "team_b") return "Away";
  if (prediction === "draw") return "Draw";
  return prediction;
}

const TOP3_COLORS = ["bg-yellow-50 dark:bg-yellow-950", "bg-slate-50 dark:bg-slate-900", "bg-orange-50 dark:bg-orange-950"];

const EXAMPLE_RESPONSE = JSON.stringify({
  data: {
    campaign: { name: "FIFA World Cup 2026 — Predict & Win", status: "active" },
    updated_at: "2026-06-15T10:00:00Z",
    standings: [
      { rank: 1, name: "Milan K.", correct: 8, scored: 12, pct: 67 },
      { rank: 2, name: "Participant", correct: 7, scored: 12, pct: 58 },
    ],
    results: [
      { match_label: "Mexico vs South Africa", score: "2–1", outcome: "team_a", status: "final" },
    ],
    pending_matches: [{ match_id: "espn-760416", match_label: "USA vs Canada" }],
  },
}, null, 2);

function GearDialog({
  campaignId,
  campaign,
  open,
  onClose,
  onUpdated,
}: {
  campaignId: string;
  campaign: Campaign;
  open: boolean;
  onClose: () => void;
  onUpdated: (patch: { public_enabled: boolean; public_token: string | null }) => void;
}) {
  const [saving, setSaving] = useState(false);
  const [confirmRegen, setConfirmRegen] = useState(false);
  const [copied, setCopied] = useState(false);
  const [exampleOpen, setExampleOpen] = useState(false);

  const publicUrl = campaign.public_token
    ? `${process.env.NEXT_PUBLIC_APP_URL || (typeof window !== "undefined" ? window.location.origin : "")}/api/public/campaigns/${campaign.public_token}/leaderboard`
    : null;

  async function patchCampaign(body: { public_enabled?: boolean; regenerate_token?: boolean }) {
    setSaving(true);
    try {
      const res = await fetch(`/api/v1/campaigns/${campaignId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const json = await res.json();
      if (json.data) onUpdated(json.data);
    } finally {
      setSaving(false);
      setConfirmRegen(false);
    }
  }

  function copyUrl() {
    if (!publicUrl) return;
    navigator.clipboard.writeText(publicUrl).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Public Leaderboard Settings</DialogTitle>
        </DialogHeader>

        <div className="flex flex-col gap-5 py-2">
          {/* Toggle */}
          <div className="flex items-start gap-3">
            <Checkbox
              id="public-toggle"
              checked={!!campaign.public_enabled}
              disabled={saving}
              onCheckedChange={(checked) => patchCampaign({ public_enabled: checked === true })}
              className="mt-0.5"
            />
            <div>
              <Label htmlFor="public-toggle" className="text-sm font-medium cursor-pointer">
                Public leaderboard
              </Label>
              <p className="text-xs text-muted-foreground mt-0.5">
                Anyone with the URL can view masked standings (names only, no contact info).
              </p>
            </div>
          </div>

          {/* URL + copy */}
          {campaign.public_enabled && publicUrl && (
            <div className="flex flex-col gap-2">
              <Label className="text-xs text-muted-foreground">Public URL</Label>
              <div className="flex items-center gap-2">
                <code className="flex-1 truncate rounded bg-muted px-2 py-1.5 text-xs">
                  {publicUrl}
                </code>
                <Button size="icon" variant="outline" className="shrink-0 h-8 w-8" onClick={copyUrl}>
                  {copied ? <Check className="h-3.5 w-3.5 text-green-600" /> : <Copy className="h-3.5 w-3.5" />}
                </Button>
              </div>
              <p className="text-xs text-muted-foreground">
                Freshness is tied to admin &ldquo;Refresh results&rdquo; — no automatic updates.
              </p>
            </div>
          )}

          {/* Regenerate token */}
          {campaign.public_enabled && (
            <div className="border-t pt-4">
              {!confirmRegen ? (
                <Button
                  size="sm"
                  variant="outline"
                  className="text-destructive border-destructive/40 hover:bg-destructive/10"
                  onClick={() => setConfirmRegen(true)}
                  disabled={saving}
                >
                  Regenerate token
                </Button>
              ) : (
                <div className="flex flex-col gap-2">
                  <p className="text-sm text-destructive">
                    This will break the existing URL. Are you sure?
                  </p>
                  <div className="flex gap-2">
                    <Button size="sm" variant="destructive" disabled={saving} onClick={() => patchCampaign({ regenerate_token: true })}>
                      Yes, regenerate
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => setConfirmRegen(false)}>
                      Cancel
                    </Button>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Example response */}
          <div className="border-t pt-4">
            <button
              className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition-colors"
              onClick={() => setExampleOpen((v) => !v)}
            >
              {exampleOpen ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
              Example API response shape
            </button>
            {exampleOpen && (
              <pre className="mt-2 max-h-64 overflow-auto rounded bg-muted p-3 text-xs leading-relaxed">
                {EXAMPLE_RESPONSE}
              </pre>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function CampaignDetail({ campaignId }: { campaignId: string }) {
  const [data, setData] = useState<LeaderboardData | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [expandedRow, setExpandedRow] = useState<string | null>(null);
  const [gearOpen, setGearOpen] = useState(false);

  const loadLeaderboard = useCallback(() => {
    setLoading(true);
    setError(null);
    fetch(`/api/v1/campaigns/${campaignId}/leaderboard`)
      .then((r) => r.json())
      .then((json) => {
        if (json.error) throw new Error(json.error.message);
        setData(json.data);
      })
      .catch((e: Error) => setError(e.message))
      .finally(() => setLoading(false));
  }, [campaignId]);

  useEffect(() => {
    loadLeaderboard();
  }, [loadLeaderboard]);

  const handleRefresh = async () => {
    setRefreshing(true);
    try {
      await fetch(`/api/v1/campaigns/${campaignId}/refresh`, { method: "POST" });
      await loadLeaderboard();
    } finally {
      setRefreshing(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64 text-muted-foreground text-sm">
        Loading leaderboard…
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-center h-64 gap-2 text-destructive text-sm">
        <AlertCircle className="h-4 w-4" />
        {error}
      </div>
    );
  }

  if (!data) return null;

  const { campaign, standings, results, pending_matches } = data;

  function handleGearUpdated(patch: { public_enabled: boolean; public_token: string | null }) {
    setData((prev) => prev ? { ...prev, campaign: { ...prev.campaign, ...patch } } : prev);
  }

  return (
    <div className="flex flex-col gap-6">
      {/* Header */}
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-3">
          <Trophy className="h-5 w-5 text-muted-foreground" />
          <div>
            <h1 className="text-xl font-semibold">{campaign.name}</h1>
            <p className="text-xs text-muted-foreground">
              Last updated {new Date(campaign.updated_at).toLocaleString()}
            </p>
          </div>
          <Badge variant={campaign.status === "active" ? "default" : "secondary"} className="capitalize">
            {campaign.status}
          </Badge>
        </div>
        <div className="flex items-center gap-2">
          <Button
            size="sm"
            variant="outline"
            onClick={handleRefresh}
            disabled={refreshing}
            className="gap-2"
          >
            <RefreshCw className={`h-4 w-4 ${refreshing ? "animate-spin" : ""}`} />
            {refreshing ? "Refreshing…" : "Refresh results"}
          </Button>
          <Button
            size="icon"
            variant="outline"
            className="h-8 w-8"
            onClick={() => setGearOpen(true)}
            title="Public leaderboard settings"
          >
            <Settings className="h-4 w-4" />
          </Button>
        </div>
      </div>

      <GearDialog
        campaignId={campaignId}
        campaign={campaign}
        open={gearOpen}
        onClose={() => setGearOpen(false)}
        onUpdated={handleGearUpdated}
      />

      {/* Pending banner */}
      {pending_matches.length > 0 && (
        <div className="flex items-center gap-2 rounded-md border border-amber-200 bg-amber-50 dark:border-amber-800 dark:bg-amber-950 px-4 py-3 text-sm text-amber-800 dark:text-amber-200">
          <AlertCircle className="h-4 w-4 shrink-0" />
          <span>
            <strong>{pending_matches.length} match{pending_matches.length !== 1 ? "es" : ""} pending</strong>
            {" "}— standings are not final yet.
          </span>
        </div>
      )}

      {/* Results table */}
      <section>
        <h2 className="text-sm font-semibold mb-3">Match Results</h2>
        <div className="rounded-md border overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Match</TableHead>
                <TableHead>Score</TableHead>
                <TableHead>Outcome</TableHead>
                <TableHead>Source</TableHead>
                <TableHead className="w-16">Locked</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {results.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} className="text-center text-muted-foreground text-sm py-6">
                    No results yet. Click &ldquo;Refresh results&rdquo; to fetch from ESPN.
                  </TableCell>
                </TableRow>
              ) : (
                results.map((r) => (
                  <TableRow key={r.match_id}>
                    <TableCell className="font-medium text-sm">{r.match_label || r.match_id}</TableCell>
                    <TableCell className="text-sm">
                      {r.status === "final" && r.home_score != null
                        ? `${r.home_score}–${r.away_score}`
                        : <span className="text-muted-foreground">Pending</span>}
                    </TableCell>
                    <TableCell className="text-sm">{outcomeLabel(r.outcome)}</TableCell>
                    <TableCell>
                      <Badge variant="outline" className="text-xs">
                        {r.source ?? "espn"}
                      </Badge>
                    </TableCell>
                    <TableCell>
                      {r.locked && <Lock className="h-3.5 w-3.5 text-muted-foreground" />}
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
      </section>

      {/* Leaderboard table */}
      <section>
        <h2 className="text-sm font-semibold mb-3">Leaderboard</h2>
        <div className="rounded-md border overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-12">Rank</TableHead>
                <TableHead>Name</TableHead>
                <TableHead className="text-right">Score</TableHead>
                <TableHead className="text-right">Accuracy</TableHead>
                <TableHead>Contact</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {standings.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={5} className="text-center text-muted-foreground text-sm py-6">
                    No standings yet.
                  </TableCell>
                </TableRow>
              ) : (
                standings.map((entry) => {
                  const isExpanded = expandedRow === entry.email;
                  const rowBg = entry.rank <= 3 ? TOP3_COLORS[entry.rank - 1] : "";
                  return (
                    <>
                      <TableRow
                        key={entry.email}
                        className={`cursor-pointer ${rowBg}`}
                        onClick={() => setExpandedRow(isExpanded ? null : entry.email)}
                      >
                        <TableCell className="font-mono text-sm font-semibold">{entry.rank}</TableCell>
                        <TableCell className="font-medium text-sm">{entry.name}</TableCell>
                        <TableCell className="text-right text-sm tabular-nums">
                          {entry.correct}/{entry.scored}
                        </TableCell>
                        <TableCell className="text-right text-sm tabular-nums">
                          {entry.scored > 0 ? `${entry.pct}%` : "—"}
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground">
                          <div>{entry.email}</div>
                          {entry.phone && <div>{entry.phone}</div>}
                        </TableCell>
                      </TableRow>
                      {isExpanded && (
                        <TableRow key={`${entry.email}-picks`} className={rowBg}>
                          <TableCell />
                          <TableCell colSpan={4} className="pb-3 pt-0">
                            <div className="rounded-md border bg-muted/30 text-xs">
                              <table className="w-full">
                                <thead>
                                  <tr className="border-b">
                                    <th className="text-left p-2 font-medium">Match</th>
                                    <th className="text-left p-2 font-medium">Pick</th>
                                    <th className="text-left p-2 font-medium">Result</th>
                                    <th className="text-left p-2 font-medium">✓</th>
                                  </tr>
                                </thead>
                                <tbody>
                                  {entry.picks.map((pick) => {
                                    const correct =
                                      pick.status === "final" && pick.outcome !== null
                                        ? pick.prediction === pick.outcome
                                        : null;
                                    return (
                                      <tr key={pick.match_id} className="border-b last:border-0">
                                        <td className="p-2">{pick.match_label || pick.match_id}</td>
                                        <td className="p-2">{predictionLabel(pick.prediction)}</td>
                                        <td className="p-2">
                                          {pick.status === "final"
                                            ? outcomeLabel(pick.outcome)
                                            : <span className="text-muted-foreground">Pending</span>}
                                        </td>
                                        <td className="p-2">
                                          {correct === null
                                            ? "—"
                                            : correct
                                            ? <span className="text-green-600">✓</span>
                                            : <span className="text-red-500">✗</span>}
                                        </td>
                                      </tr>
                                    );
                                  })}
                                </tbody>
                              </table>
                            </div>
                          </TableCell>
                        </TableRow>
                      )}
                    </>
                  );
                })
              )}
            </TableBody>
          </Table>
        </div>
      </section>
    </div>
  );
}
