"use client";

import { useState, useEffect, useCallback } from "react";
import {
  RefreshCw,
  TrendingUp,
  Lightbulb,
  MessageSquare,
  Users,
  AlertTriangle,
  CheckCircle2,
  Clock,
  Phone,
  Mail,
  FileText,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { AISparkleIcon, AISparkleIconLarge } from "@/components/ui/ai-sparkle";
import type { Lead, LeadNote, LeadInsightsResponse } from "@/types/database";

interface AIInsightsTabProps {
  lead: Lead;
  notes: LeadNote[];
}

export function AIInsightsTab({ lead }: AIInsightsTabProps) {
  const [isLoading, setIsLoading] = useState(true);
  const [isRegenerating, setIsRegenerating] = useState(false);
  const [insights, setInsights] = useState<LeadInsightsResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Fetch insights from API
  const fetchInsights = useCallback(async () => {
    try {
      const res = await fetch(`/api/v1/leads/${lead.id}/insights`);
      if (!res.ok) {
        throw new Error("Failed to fetch insights");
      }
      const data = await res.json();
      return data.data;
    } catch (err) {
      console.error("Fetch insights error:", err);
      throw err;
    }
  }, [lead.id]);

  // Generate new insights
  const generateInsights = useCallback(async (force = false) => {
    try {
      const url = force
        ? `/api/v1/leads/${lead.id}/insights?force=true`
        : `/api/v1/leads/${lead.id}/insights`;

      const res = await fetch(url, { method: "POST" });
      if (!res.ok) {
        throw new Error("Failed to generate insights");
      }
      const data = await res.json();
      return data.data;
    } catch (err) {
      console.error("Generate insights error:", err);
      throw err;
    }
  }, [lead.id]);

  // Initial load
  useEffect(() => {
    let isMounted = true;

    async function loadInsights() {
      setIsLoading(true);
      setError(null);

      try {
        // First, try to get cached insights
        const cached = await fetchInsights();

        if (cached.insights && !cached.insights.isExpired) {
          // Use cached insights
          if (isMounted) {
            setInsights(cached.insights);
            setIsLoading(false);
          }
        } else {
          // No cached insights or expired - generate new ones
          const generated = await generateInsights(false);
          if (isMounted) {
            setInsights(generated.insights);
            setIsLoading(false);
          }
        }
      } catch {
        if (isMounted) {
          setError("Failed to load insights. Please try again.");
          setIsLoading(false);
        }
      }
    }

    loadInsights();

    return () => {
      isMounted = false;
    };
  }, [fetchInsights, generateInsights]);

  // Handle regenerate button
  const handleRegenerate = async () => {
    setIsRegenerating(true);
    setError(null);

    try {
      const result = await generateInsights(true);
      setInsights(result.insights);
    } catch {
      setError("Failed to regenerate insights. Please try again.");
    } finally {
      setIsRegenerating(false);
    }
  };

  if (isLoading) {
    return <AIInsightsLoading />;
  }

  if (error) {
    return <AIInsightsError error={error} onRetry={handleRegenerate} />;
  }

  if (!insights) {
    return <AIInsightsEmpty onGenerate={handleRegenerate} isLoading={isRegenerating} />;
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <AISparkleIcon className="size-4" />
          <span>Generated {formatRelativeTime(insights.generated_at)}</span>
          {insights.isStale && (
            <Badge variant="outline" className="text-amber-600 border-amber-300">
              Stale
            </Badge>
          )}
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={handleRegenerate}
          disabled={isRegenerating}
          className="gap-2"
        >
          <RefreshCw className={`size-3.5 ${isRegenerating ? "animate-spin" : ""}`} />
          Regenerate
        </Button>
      </div>

      {/* Lead Score - Gradient Border Card */}
      <div className="relative rounded-xl p-[1px] bg-gradient-to-br from-[#2272B4] via-[#6366F1] to-[#8B5CF6]">
        <div className="rounded-[11px] bg-card p-4">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <TrendingUp className="size-4 text-purple-500" />
              <h3 className="font-semibold">Lead Score</h3>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-2xl font-bold">{insights.score}</span>
              <span className="text-muted-foreground">/100</span>
              <Badge
                variant="secondary"
                className={getScoreBadgeColor(insights.score_label)}
              >
                {insights.score_label}
              </Badge>
            </div>
          </div>

          {/* Score Progress Bar */}
          <div className="h-2 w-full rounded-full bg-muted overflow-hidden mb-3">
            <div
              className="h-full bg-gradient-to-r from-[#2272B4] to-[#8B5CF6] transition-all duration-500"
              style={{ width: `${insights.score}%` }}
            />
          </div>

          {/* Score Factors */}
          <div className="flex flex-wrap gap-2">
            {insights.factors.map((factor, index) => (
              <span
                key={index}
                className={`text-xs px-2 py-1 rounded-full ${
                  factor.impact === "positive"
                    ? "bg-green-50 text-green-700"
                    : factor.impact === "negative"
                    ? "bg-red-50 text-red-700"
                    : "bg-gray-50 text-gray-700"
                }`}
              >
                {factor.impact === "positive" ? "+" : factor.impact === "negative" ? "−" : "•"}{" "}
                {factor.label}
              </span>
            ))}
          </div>
        </div>
      </div>

      {/* Quick Summary */}
      <AISection icon={MessageSquare} title="Quick Summary">
        <p className="text-sm text-foreground leading-relaxed">
          {insights.summary}
        </p>
      </AISection>

      {/* Recommended Actions */}
      <AISection
        icon={Lightbulb}
        title="Recommended Actions"
        badge={`${insights.actions.length}`}
      >
        <div className="space-y-3">
          {insights.actions.map((action, index) => (
            <div
              key={action.id}
              className="flex items-start gap-3 p-3 rounded-lg bg-muted/50 hover:bg-muted transition-colors"
            >
              <div
                className={`size-6 rounded-full flex items-center justify-center shrink-0 ${
                  action.priority === "high"
                    ? "bg-red-100 text-red-600"
                    : action.priority === "medium"
                    ? "bg-amber-100 text-amber-600"
                    : "bg-blue-100 text-blue-600"
                }`}
              >
                <span className="text-xs font-medium">{index + 1}</span>
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <p className="text-sm font-medium">{action.title}</p>
                  {action.priority === "high" && (
                    <Badge variant="destructive" className="h-4 px-1 text-[10px]">
                      Urgent
                    </Badge>
                  )}
                </div>
                <p className="text-xs text-muted-foreground mt-0.5">
                  {action.description}
                </p>
              </div>
              <ActionIcon type={action.actionType} />
            </div>
          ))}
        </div>
      </AISection>

      {/* Engagement Summary */}
      <AISection icon={Users} title="Engagement Summary">
        <div className="grid grid-cols-2 gap-4">
          <EngagementStat
            label="Total Interactions"
            value={String(insights.engagement.totalInteractions)}
            icon={MessageSquare}
          />
          <EngagementStat
            label="Last Contact"
            value={insights.engagement.lastInteraction}
            icon={Clock}
          />
          <EngagementStat
            label="Response Rate"
            value={insights.engagement.responseRate}
            icon={CheckCircle2}
          />
          <EngagementStat
            label="Avg Response Time"
            value={insights.engagement.avgResponseTime}
            icon={TrendingUp}
          />
        </div>
      </AISection>

      {/* AI Disclaimer */}
      <div className="flex items-center gap-2 text-xs text-muted-foreground px-1">
        <AISparkleIcon className="size-3 opacity-50" />
        <span>AI-generated insights. Verify information before taking action.</span>
      </div>
    </div>
  );
}

// Helper Components
function AISection({
  icon: Icon,
  title,
  badge,
  children,
}: {
  icon: React.ElementType;
  title: string;
  badge?: string;
  children: React.ReactNode;
}) {
  return (
    <Card className="shadow-none rounded-lg py-0 border-l-2 border-l-purple-400">
      <CardHeader className="pt-4 pb-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Icon className="size-4 text-purple-500" />
            <CardTitle className="text-base">{title}</CardTitle>
          </div>
          {badge && (
            <Badge variant="secondary" className="h-5 px-1.5 text-xs">
              {badge}
            </Badge>
          )}
        </div>
      </CardHeader>
      <CardContent className="pb-4">{children}</CardContent>
    </Card>
  );
}

function EngagementStat({
  label,
  value,
  icon: Icon,
}: {
  label: string;
  value: string;
  icon: React.ElementType;
}) {
  return (
    <div className="flex items-center gap-3">
      <div className="size-8 rounded-full bg-purple-50 flex items-center justify-center">
        <Icon className="size-4 text-purple-500" />
      </div>
      <div>
        <p className="text-sm font-medium">{value}</p>
        <p className="text-xs text-muted-foreground">{label}</p>
      </div>
    </div>
  );
}

function ActionIcon({ type }: { type: string }) {
  const iconMap = {
    call: Phone,
    email: Mail,
    task: CheckCircle2,
    update: FileText,
  };
  const Icon = iconMap[type as keyof typeof iconMap] || FileText;
  return (
    <div className="size-8 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
      <Icon className="size-4 text-primary" />
    </div>
  );
}

// Loading State
function AIInsightsLoading() {
  return (
    <div className="space-y-4">
      {/* Active generation indicator */}
      <div className="relative rounded-xl p-[1px] bg-gradient-to-br from-[#2272B4] via-[#6366F1] to-[#8B5CF6] animate-pulse">
        <div className="rounded-[11px] bg-card p-6">
          <div className="flex items-center gap-3">
            <AISparkleIcon className="size-5 animate-spin" animated />
            <div>
              <p className="font-medium">Loading insights...</p>
              <p className="text-sm text-muted-foreground">
                Fetching cached data
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Skeleton sections */}
      <Card className="shadow-none rounded-lg py-0">
        <CardContent className="py-4 space-y-3">
          <Skeleton className="h-4 w-32" />
          <Skeleton className="h-16 w-full" />
        </CardContent>
      </Card>

      <Card className="shadow-none rounded-lg py-0">
        <CardContent className="py-4 space-y-3">
          <Skeleton className="h-4 w-40" />
          <Skeleton className="h-12 w-full" />
          <Skeleton className="h-12 w-full" />
        </CardContent>
      </Card>
    </div>
  );
}

// Empty State
function AIInsightsEmpty({ onGenerate, isLoading }: { onGenerate: () => void; isLoading?: boolean }) {
  return (
    <div className="flex flex-col items-center justify-center py-12 px-4 text-center">
      <AISparkleIconLarge muted />
      <h3 className="mt-4 text-lg font-semibold">Generate AI Insights</h3>
      <p className="mt-2 text-sm text-muted-foreground max-w-sm">
        Get AI-powered analysis of this lead including scoring, recommended actions, and engagement patterns.
      </p>
      <Button onClick={onGenerate} className="mt-6 gap-2" disabled={isLoading}>
        {isLoading ? (
          <>
            <RefreshCw className="size-4 animate-spin" />
            Generating...
          </>
        ) : (
          <>
            <AISparkleIcon className="size-4" />
            Generate Insights
          </>
        )}
      </Button>
    </div>
  );
}

// Error State
function AIInsightsError({ error, onRetry }: { error: string; onRetry: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center py-12 px-4 text-center">
      <div className="size-12 rounded-full bg-amber-100 flex items-center justify-center">
        <AlertTriangle className="size-6 text-amber-600" />
      </div>
      <h3 className="mt-4 text-lg font-semibold">Could not load insights</h3>
      <p className="mt-2 text-sm text-muted-foreground max-w-sm">
        {error || "We ran into an issue. This is usually temporary."}
      </p>
      <Button onClick={onRetry} variant="outline" className="mt-6 gap-2">
        <RefreshCw className="size-4" />
        Try Again
      </Button>
    </div>
  );
}

// Utility functions
function getScoreBadgeColor(label: string): string {
  switch (label) {
    case "High":
      return "bg-green-100 text-green-700 hover:bg-green-100";
    case "Medium":
      return "bg-amber-100 text-amber-700 hover:bg-amber-100";
    case "Low":
      return "bg-red-100 text-red-700 hover:bg-red-100";
    default:
      return "";
  }
}

function formatRelativeTime(dateString: string): string {
  const date = new Date(dateString);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / (1000 * 60));
  const diffHours = Math.floor(diffMs / (1000 * 60 * 60));
  const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24));

  if (diffMins < 1) return "just now";
  if (diffMins < 60) return `${diffMins} min ago`;
  if (diffHours < 24) return `${diffHours} hour${diffHours > 1 ? "s" : ""} ago`;
  if (diffDays === 1) return "yesterday";
  if (diffDays < 7) return `${diffDays} days ago`;

  return date.toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
  });
}
