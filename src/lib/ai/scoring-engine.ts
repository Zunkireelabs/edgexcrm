/**
 * AI Lead Scoring Engine
 *
 * Rule-based scoring system that calculates lead scores (0-100) based on:
 * - Contact information completeness
 * - Engagement level (notes, activity)
 * - Data completeness
 * - Stage alignment
 *
 * This is Phase 1 (rule-based). Future phases will add ML-based scoring.
 */

import type {
  Lead,
  LeadNote,
  AIScoreFactor,
  AIScoreLabel,
  AIPriorityTier,
  AIRecommendedAction,
  AIEngagementStats,
  LeadInsights,
} from "@/types/database";

// Scoring weights - can be made configurable per tenant in future
const WEIGHTS = {
  // Contact info (max +30)
  CONTACT_EMAIL: 15,
  CONTACT_PHONE: 15,
  CONTACT_LOCATION: 5,

  // Engagement (max +25)
  ENGAGEMENT_PER_NOTE: 5,
  ENGAGEMENT_MAX_NOTES: 15,
  ENGAGEMENT_RECENT_ACTIVITY: 10,
  ENGAGEMENT_STALE_PENALTY: -10,

  // Completeness (max +15)
  COMPLETENESS_CUSTOM_FIELDS: 10,
  COMPLETENESS_CONTACT_METHOD: 5,

  // Stage alignment (±10)
  STAGE_ALIGNED: 10,
  STAGE_MISALIGNED: -10,

  // Base score
  BASE_SCORE: 50,
};

// Time thresholds
const RECENT_ACTIVITY_DAYS = 7;
const STALE_ACTIVITY_DAYS = 30;

interface ScoringInput {
  lead: Lead;
  notes: LeadNote[];
  lastActivityDate?: Date;
}

interface ScoringResult {
  score: number;
  scoreLabel: AIScoreLabel;
  priorityTier: AIPriorityTier;
  factors: AIScoreFactor[];
}

/**
 * Calculate lead score based on available data
 */
export function calculateLeadScore(input: ScoringInput): ScoringResult {
  const { lead, notes } = input;
  const factors: AIScoreFactor[] = [];
  let score = WEIGHTS.BASE_SCORE;

  // =========================================================================
  // CONTACT INFO SCORING (max +30)
  // =========================================================================

  if (lead.email) {
    score += WEIGHTS.CONTACT_EMAIL;
    factors.push({
      label: "Has email",
      impact: "positive",
      points: WEIGHTS.CONTACT_EMAIL,
    });
  } else {
    factors.push({
      label: "Missing email",
      impact: "negative",
      points: 0,
    });
  }

  if (lead.phone) {
    score += WEIGHTS.CONTACT_PHONE;
    factors.push({
      label: "Has phone",
      impact: "positive",
      points: WEIGHTS.CONTACT_PHONE,
    });
  } else {
    factors.push({
      label: "Missing phone",
      impact: "negative",
      points: 0,
    });
  }

  if (lead.city || lead.country) {
    score += WEIGHTS.CONTACT_LOCATION;
    factors.push({
      label: "Has location",
      impact: "positive",
      points: WEIGHTS.CONTACT_LOCATION,
    });
  }

  // =========================================================================
  // ENGAGEMENT SCORING (max +25)
  // =========================================================================

  const noteCount = notes.length;
  if (noteCount > 0) {
    const notePoints = Math.min(
      noteCount * WEIGHTS.ENGAGEMENT_PER_NOTE,
      WEIGHTS.ENGAGEMENT_MAX_NOTES
    );
    score += notePoints;
    factors.push({
      label: `${noteCount} interaction${noteCount > 1 ? "s" : ""}`,
      impact: "positive",
      points: notePoints,
    });
  }

  // Check activity recency
  const lastActivity = getLastActivityDate(lead, notes);
  const daysSinceActivity = getDaysSince(lastActivity);

  if (daysSinceActivity <= RECENT_ACTIVITY_DAYS) {
    score += WEIGHTS.ENGAGEMENT_RECENT_ACTIVITY;
    factors.push({
      label: "Recent activity",
      impact: "positive",
      points: WEIGHTS.ENGAGEMENT_RECENT_ACTIVITY,
    });
  } else if (daysSinceActivity >= STALE_ACTIVITY_DAYS) {
    score += WEIGHTS.ENGAGEMENT_STALE_PENALTY;
    factors.push({
      label: "No activity in 30+ days",
      impact: "negative",
      points: WEIGHTS.ENGAGEMENT_STALE_PENALTY,
    });
  }

  // =========================================================================
  // COMPLETENESS SCORING (max +15)
  // =========================================================================

  const customFieldCount = Object.keys(lead.custom_fields || {}).filter(
    (key) => lead.custom_fields[key] != null && lead.custom_fields[key] !== ""
  ).length;

  if (customFieldCount >= 2) {
    score += WEIGHTS.COMPLETENESS_CUSTOM_FIELDS;
    factors.push({
      label: "Profile complete",
      impact: "positive",
      points: WEIGHTS.COMPLETENESS_CUSTOM_FIELDS,
    });
  }

  if (lead.preferred_contact_method) {
    score += WEIGHTS.COMPLETENESS_CONTACT_METHOD;
    factors.push({
      label: "Contact preference set",
      impact: "positive",
      points: WEIGHTS.COMPLETENESS_CONTACT_METHOD,
    });
  }

  // =========================================================================
  // STAGE ALIGNMENT (±10)
  // =========================================================================

  // Check if lead is stuck in "new" stage despite having interactions
  if (lead.status === "new" && noteCount > 0) {
    score += WEIGHTS.STAGE_MISALIGNED;
    factors.push({
      label: "Stage needs update",
      impact: "negative",
      points: WEIGHTS.STAGE_MISALIGNED,
    });
  } else if (lead.status !== "new" && noteCount > 0) {
    // Lead has progressed and has engagement
    factors.push({
      label: "Good stage progression",
      impact: "neutral",
      points: 0,
    });
  }

  // =========================================================================
  // FINALIZE SCORE
  // =========================================================================

  // Clamp score to 0-100
  score = Math.max(0, Math.min(100, score));

  // Determine label and priority
  const scoreLabel = getScoreLabel(score);
  const priorityTier = getPriorityTier(score);

  return {
    score,
    scoreLabel,
    priorityTier,
    factors: factors.filter((f) => f.points !== 0 || f.impact !== "neutral"),
  };
}

/**
 * Generate recommended actions based on lead data
 */
export function generateRecommendedActions(
  lead: Lead,
  notes: LeadNote[],
  score: number
): AIRecommendedAction[] {
  const actions: AIRecommendedAction[] = [];

  // No contact yet - highest priority
  if (notes.length === 0) {
    actions.push({
      id: "initial-contact",
      priority: "high",
      title: "Make initial contact",
      description:
        "This lead hasn't been contacted yet. Reach out within 24 hours for best conversion rates.",
      actionType: "call",
    });
  }

  // Missing phone - request it
  if (!lead.phone && lead.email) {
    actions.push({
      id: "request-phone",
      priority: "medium",
      title: "Request phone number",
      description:
        "Phone contact typically leads to faster conversions. Ask for their number in next email.",
      actionType: "email",
    });
  }

  // Stage needs update
  if (lead.status === "new" && notes.length > 0) {
    actions.push({
      id: "update-stage",
      priority: "medium",
      title: "Update lead stage",
      description:
        "This lead has been contacted but is still marked as 'New'. Update to reflect current status.",
      actionType: "update",
    });
  }

  // Stale lead - re-engage
  const daysSinceActivity = getDaysSince(getLastActivityDate(lead, notes));
  if (daysSinceActivity >= STALE_ACTIVITY_DAYS && notes.length > 0) {
    actions.push({
      id: "re-engage",
      priority: "high",
      title: "Re-engage stale lead",
      description: `No activity in ${daysSinceActivity} days. Send a follow-up to maintain engagement.`,
      actionType: "email",
    });
  }

  // High score - prioritize
  if (score >= 80) {
    actions.push({
      id: "prioritize",
      priority: "high",
      title: "High-priority follow-up",
      description:
        "This lead shows strong signals. Schedule a call to move forward quickly.",
      actionType: "call",
    });
  }

  // Add generic follow-up task if not enough actions
  if (actions.length < 2) {
    actions.push({
      id: "follow-up",
      priority: "low",
      title: "Schedule follow-up",
      description:
        "Add a follow-up task to maintain engagement and move the lead forward.",
      actionType: "task",
    });
  }

  // Return top 3 actions, sorted by priority
  return actions
    .sort((a, b) => {
      const priorityOrder = { high: 0, medium: 1, low: 2 };
      return priorityOrder[a.priority] - priorityOrder[b.priority];
    })
    .slice(0, 3);
}

/**
 * Generate engagement statistics
 */
export function generateEngagementStats(
  lead: Lead,
  notes: LeadNote[]
): AIEngagementStats {
  const lastActivity = getLastActivityDate(lead, notes);

  return {
    totalInteractions: notes.length,
    lastInteraction:
      notes.length > 0 ? formatRelativeTime(lastActivity) : "Never",
    responseRate: notes.length > 0 ? "Active" : "N/A",
    avgResponseTime: notes.length > 0 ? "< 24 hours" : "N/A",
  };
}

/**
 * Generate summary text
 */
export function generateSummary(
  lead: Lead,
  notes: LeadNote[],
  scoreLabel: AIScoreLabel
): string {
  const fullName =
    `${lead.first_name || ""} ${lead.last_name || ""}`.trim() || "This lead";
  const location = [lead.city, lead.country].filter(Boolean).join(", ");

  let summary = `${fullName}`;

  if (location) {
    summary += ` from ${location}`;
  }

  summary += ` submitted an inquiry`;

  if (lead.created_at) {
    summary += ` on ${new Date(lead.created_at).toLocaleDateString("en-US", {
      month: "long",
      day: "numeric",
      year: "numeric",
    })}`;
  }

  summary += ". ";

  if (notes.length > 0) {
    summary += `There have been ${notes.length} recorded interaction${
      notes.length > 1 ? "s" : ""
    }. `;
  } else {
    summary += "No interactions recorded yet - this lead needs initial contact. ";
  }

  if (scoreLabel === "High") {
    summary += "This is a high-priority lead with strong engagement signals.";
  } else if (scoreLabel === "Low") {
    summary += "This lead may need nurturing to increase engagement.";
  }

  if (lead.preferred_contact_method) {
    summary += ` Preferred contact: ${lead.preferred_contact_method}.`;
  }

  return summary;
}

/**
 * Generate complete insights for a lead
 */
export function generateLeadInsights(
  lead: Lead,
  notes: LeadNote[],
  tenantId: string
): Omit<LeadInsights, "id" | "created_at" | "updated_at"> {
  const { score, scoreLabel, priorityTier, factors } = calculateLeadScore({
    lead,
    notes,
  });

  const actions = generateRecommendedActions(lead, notes, score);
  const engagement = generateEngagementStats(lead, notes);
  const summary = generateSummary(lead, notes, scoreLabel);

  const now = new Date();
  const expiresAt = new Date(now.getTime() + 24 * 60 * 60 * 1000); // 24 hours

  return {
    tenant_id: tenantId,
    lead_id: lead.id,
    score,
    score_label: scoreLabel,
    priority_tier: priorityTier,
    factors,
    summary,
    actions,
    engagement,
    generated_at: now.toISOString(),
    expires_at: expiresAt.toISOString(),
  };
}

// ============================================================================
// Helper Functions
// ============================================================================

function getScoreLabel(score: number): AIScoreLabel {
  if (score >= 70) return "High";
  if (score >= 40) return "Medium";
  return "Low";
}

function getPriorityTier(score: number): AIPriorityTier {
  if (score >= 80) return "hot";
  if (score >= 60) return "warm";
  if (score >= 40) return "cold";
  return "unlikely";
}

function getLastActivityDate(lead: Lead, notes: LeadNote[]): Date {
  const dates: Date[] = [new Date(lead.updated_at)];

  if (notes.length > 0) {
    // Notes are typically ordered by created_at desc
    dates.push(new Date(notes[0].created_at));
  }

  return new Date(Math.max(...dates.map((d) => d.getTime())));
}

function getDaysSince(date: Date): number {
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  return Math.floor(diffMs / (1000 * 60 * 60 * 24));
}

function formatRelativeTime(date: Date): string {
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
