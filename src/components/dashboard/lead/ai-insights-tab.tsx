"use client";

import { useState } from "react";
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
import type { Lead, LeadNote } from "@/types/database";

// Types for AI insights (will be populated by API later)
interface LeadScoreFactor {
  label: string;
  impact: "positive" | "negative" | "neutral";
  value: string;
}

interface RecommendedAction {
  id: string;
  priority: "high" | "medium" | "low";
  title: string;
  description: string;
  actionType: "call" | "email" | "task" | "update";
}

interface AIInsights {
  score: number;
  scoreLabel: "High" | "Medium" | "Low";
  factors: LeadScoreFactor[];
  summary: string;
  actions: RecommendedAction[];
  engagement: {
    totalInteractions: number;
    lastInteraction: string;
    responseRate: string;
    avgResponseTime: string;
  };
  generatedAt: string;
}

interface AIInsightsTabProps {
  lead: Lead;
  notes: LeadNote[];
}

export function AIInsightsTab({ lead, notes }: AIInsightsTabProps) {
  const [isLoading, setIsLoading] = useState(false);
  const [insights, setInsights] = useState<AIInsights | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Generate mock insights for now (will be replaced with API call)
  const generateInsights = () => {
    setIsLoading(true);
    setError(null);

    // Simulate API call
    setTimeout(() => {
      const mockInsights = generateMockInsights(lead, notes);
      setInsights(mockInsights);
      setIsLoading(false);
    }, 2000);
  };

  // Auto-generate on first render if no insights
  if (!insights && !isLoading && !error) {
    generateInsights();
  }

  if (isLoading) {
    return <AIInsightsLoading />;
  }

  if (error) {
    return <AIInsightsError error={error} onRetry={generateInsights} />;
  }

  if (!insights) {
    return <AIInsightsEmpty onGenerate={generateInsights} />;
  }

  return (
    <div className="space-y-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <AISparkleIcon className="size-4" />
          <span>Generated {formatRelativeTime(insights.generatedAt)}</span>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={generateInsights}
          disabled={isLoading}
          className="gap-2"
        >
          <RefreshCw className={`size-3.5 ${isLoading ? "animate-spin" : ""}`} />
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
                className={getScoreBadgeColor(insights.scoreLabel)}
              >
                {insights.scoreLabel}
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
              <p className="font-medium">Analyzing lead data...</p>
              <p className="text-sm text-muted-foreground">
                This usually takes a few seconds
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
function AIInsightsEmpty({ onGenerate }: { onGenerate: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center py-12 px-4 text-center">
      <AISparkleIconLarge muted />
      <h3 className="mt-4 text-lg font-semibold">Generate AI Insights</h3>
      <p className="mt-2 text-sm text-muted-foreground max-w-sm">
        Get AI-powered analysis of this lead including scoring, recommended actions, and engagement patterns.
      </p>
      <Button onClick={onGenerate} className="mt-6 gap-2">
        <AISparkleIcon className="size-4" />
        Generate Insights
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
      <h3 className="mt-4 text-lg font-semibold">Couldn't generate insights</h3>
      <p className="mt-2 text-sm text-muted-foreground max-w-sm">
        {error || "We ran into an issue analyzing this lead. This is usually temporary."}
      </p>
      <Button onClick={onRetry} variant="outline" className="mt-6 gap-2">
        <RefreshCw className="size-4" />
        Try Again
      </Button>
    </div>
  );
}

// Mock data generator (will be replaced with real AI)
function generateMockInsights(lead: Lead, notes: LeadNote[]): AIInsights {
  const hasEmail = !!lead.email;
  const hasPhone = !!lead.phone;
  const hasLocation = !!(lead.city || lead.country);
  const noteCount = notes.length;

  // Calculate mock score
  let score = 50;
  if (hasEmail) score += 15;
  if (hasPhone) score += 15;
  if (hasLocation) score += 10;
  if (noteCount > 0) score += Math.min(noteCount * 5, 15);

  const factors: LeadScoreFactor[] = [];
  if (hasEmail && hasPhone) {
    factors.push({ label: "Complete contact info", impact: "positive", value: "+15%" });
  }
  if (noteCount > 0) {
    factors.push({ label: `${noteCount} interaction${noteCount > 1 ? "s" : ""}`, impact: "positive", value: "+10%" });
  }
  if (!hasPhone) {
    factors.push({ label: "Missing phone", impact: "negative", value: "-10%" });
  }
  if (lead.status === "new") {
    factors.push({ label: "New lead - needs contact", impact: "neutral", value: "" });
  }

  const fullName = `${lead.first_name || ""} ${lead.last_name || ""}`.trim() || "This lead";
  const location = [lead.city, lead.country].filter(Boolean).join(", ");

  const summary = `${fullName} ${location ? `from ${location}` : ""} submitted an inquiry${
    lead.created_at ? ` on ${new Date(lead.created_at).toLocaleDateString()}` : ""
  }. ${
    noteCount > 0
      ? `There have been ${noteCount} recorded interaction${noteCount > 1 ? "s" : ""} with this lead.`
      : "No interactions recorded yet - this lead needs initial contact."
  }${
    lead.preferred_contact_method
      ? ` Preferred contact method: ${lead.preferred_contact_method}.`
      : ""
  }`;

  const actions: RecommendedAction[] = [];

  if (noteCount === 0) {
    actions.push({
      id: "1",
      priority: "high",
      title: "Make initial contact",
      description: "This lead hasn't been contacted yet. Reach out within 24 hours for best conversion rates.",
      actionType: "call",
    });
  }

  if (!hasPhone && hasEmail) {
    actions.push({
      id: "2",
      priority: "medium",
      title: "Request phone number",
      description: "Phone contact typically leads to faster conversions. Ask for their number in next email.",
      actionType: "email",
    });
  }

  if (lead.status === "new" && noteCount > 0) {
    actions.push({
      id: "3",
      priority: "medium",
      title: "Update lead stage",
      description: "This lead has been contacted but is still marked as 'New'. Update to reflect current status.",
      actionType: "update",
    });
  }

  actions.push({
    id: "4",
    priority: "low",
    title: "Add follow-up task",
    description: "Schedule a follow-up to maintain engagement and move the lead forward.",
    actionType: "task",
  });

  return {
    score: Math.min(score, 100),
    scoreLabel: score >= 70 ? "High" : score >= 40 ? "Medium" : "Low",
    factors,
    summary,
    actions: actions.slice(0, 3),
    engagement: {
      totalInteractions: noteCount,
      lastInteraction: noteCount > 0 && notes[0] ? formatRelativeTime(notes[0].created_at) : "Never",
      responseRate: noteCount > 0 ? "Good" : "N/A",
      avgResponseTime: noteCount > 0 ? "< 24 hours" : "N/A",
    },
    generatedAt: new Date().toISOString(),
  };
}

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
