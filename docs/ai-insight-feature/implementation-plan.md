# AI Insights Feature — Production-Ready Implementation Plan

> **Status:** Planning
> **Created:** 2026-03-28
> **Last Updated:** 2026-03-28

---

## Executive Summary

Transform the current mock AI Insights feature into a production-ready, adaptive system that:
- Persists insights in the database (no regeneration on every page load)
- Refreshes intelligently based on events and TTL
- Adapts as more lead data is added
- Scales for multi-tenant SaaS

---

## Research Findings

### Industry Benchmarks

| Platform | Scoring Method | Refresh Rate | Data Requirements |
|----------|---------------|--------------|-------------------|
| **Salesforce Einstein** | ML (0-100 scale) | Every 6 hours + on attribute change | 1,000 leads, 120 conversions |
| **HubSpot** | ML with priority tiers | Real-time + daily batch | 100 customers, 1,000 non-customers |
| **Best Practice** | Hybrid (rule → ML) | Batch + event-triggered | Start rule-based, graduate to ML |

### Key Insights from Research

1. **Start Rule-Based** — ML models need 6+ months of conversion data. Rule-based scoring is 70% accurate and ships immediately.

2. **Persist Everything** — Both Salesforce and HubSpot store scores in the database, not regenerate on page load.

3. **Smart Refresh** — Only recalculate when:
   - Key properties change (email, phone, stage, notes)
   - Daily batch job runs
   - User clicks "Regenerate"

4. **Explainability is Critical** — Users need to know WHY a lead scored high/low (positive/negative factors).

5. **Multi-tenant Isolation** — Never mix tenant data for training models.

---

## Current State Analysis

### Problem

The current AI Insights feature (`src/components/dashboard/lead/ai-insights-tab.tsx`):

- **Re-analyzes on every page load** — State initialized as `null`, triggers `generateInsights()` on mount
- **Uses mock data** — 2-second `setTimeout` simulates API call with fake data
- **No persistence** — Insights lost when navigating away
- **No backend** — No database table, no API endpoint

### Current Architecture

```
User opens lead → Component mounts → useState(null) → generateInsights()
→ setTimeout(2000ms) → Mock data generated client-side → UI renders
→ User navigates away → State lost → Repeat on return
```

---

## Proposed Architecture

```
┌─────────────────────────────────────────────────────────────────────────┐
│                         AI INSIGHTS ARCHITECTURE                         │
├─────────────────────────────────────────────────────────────────────────┤
│                                                                          │
│  ┌─────────────┐     ┌──────────────┐     ┌───────────────────────┐    │
│  │ Lead Events │────▶│ Score Engine │────▶│ lead_insights table   │    │
│  │ (create,    │     │ (rule-based) │     │ (cached, TTL 24h)     │    │
│  │  update)    │     └──────────────┘     └───────────────────────┘    │
│  └─────────────┘                                     │                  │
│                                                      ▼                  │
│  ┌─────────────┐     ┌──────────────┐     ┌───────────────────────┐    │
│  │ Daily Cron  │────▶│ Batch Recalc │────▶│ UI (reads from DB,    │    │
│  │ Job         │     │ (all leads)  │     │  no regeneration)     │    │
│  └─────────────┘     └──────────────┘     └───────────────────────┘    │
│                                                                          │
│  ┌─────────────┐     ┌──────────────┐     ┌───────────────────────┐    │
│  │ User clicks │────▶│ On-Demand    │────▶│ Updated insights      │    │
│  │ "Regenerate"│     │ Recalc       │     │ (reset TTL)           │    │
│  └─────────────┘     └──────────────┘     └───────────────────────┘    │
│                                                                          │
└─────────────────────────────────────────────────────────────────────────┘
```

### Data Flow

1. **On Lead Create/Update** → Event triggers scoring engine → Insights stored in DB
2. **On Page Load** → Read cached insights from DB → Display immediately
3. **On "Regenerate" Click** → Call API with force refresh → Update DB → Update UI
4. **Daily Batch Job** → Recalculate stale insights (>24h old)

---

## Implementation Phases

### Phase 1: Database & Persistence (Foundation)

**New table: `lead_insights`**

```sql
CREATE TABLE lead_insights (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  lead_id UUID NOT NULL REFERENCES leads(id) ON DELETE CASCADE,

  -- Score
  score INTEGER NOT NULL CHECK (score >= 0 AND score <= 100),
  score_label TEXT NOT NULL CHECK (score_label IN ('High', 'Medium', 'Low')),
  priority_tier TEXT NOT NULL CHECK (priority_tier IN ('hot', 'warm', 'cold', 'unlikely')),

  -- Factors (explainability)
  factors JSONB NOT NULL DEFAULT '[]',
  -- Example: [{"label": "Complete contact info", "impact": "positive", "points": 15}]

  -- Generated content
  summary TEXT NOT NULL,
  actions JSONB NOT NULL DEFAULT '[]',
  -- Example: [{"id": "1", "priority": "high", "title": "...", "description": "...", "actionType": "call"}]

  engagement JSONB NOT NULL DEFAULT '{}',
  -- Example: {"totalInteractions": 5, "lastInteraction": "2 days ago", ...}

  -- Metadata
  generated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL DEFAULT (now() + INTERVAL '24 hours'),

  -- Constraints
  UNIQUE(lead_id),

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Indexes
CREATE INDEX idx_lead_insights_tenant ON lead_insights(tenant_id);
CREATE INDEX idx_lead_insights_lead ON lead_insights(lead_id);
CREATE INDEX idx_lead_insights_expires ON lead_insights(expires_at);
CREATE INDEX idx_lead_insights_score ON lead_insights(score DESC);

-- RLS
ALTER TABLE lead_insights ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Tenant isolation for lead_insights"
  ON lead_insights FOR ALL
  USING (tenant_id IN (SELECT get_user_tenant_ids()));
```

**Add to `leads` table:**

```sql
ALTER TABLE leads ADD COLUMN ai_score INTEGER;
ALTER TABLE leads ADD COLUMN ai_priority TEXT;
ALTER TABLE leads ADD COLUMN ai_score_updated_at TIMESTAMPTZ;

CREATE INDEX idx_leads_ai_score ON leads(ai_score DESC) WHERE ai_score IS NOT NULL;
```

### Phase 2: Scoring Engine (Rule-Based)

**Score Calculation Formula:**

```
Base Score: 50

CONTACT INFO (max +30):
├─ +15 if has email
├─ +15 if has phone
└─ +5 if has location (city or country)

ENGAGEMENT (max +25):
├─ +5 per note (max +15)
├─ +10 if activity in last 7 days
└─ -10 if no activity in 30+ days

COMPLETENESS (max +15):
├─ +10 if has custom fields filled (>2 fields)
└─ +5 if has preferred contact method

STAGE ALIGNMENT (±10):
├─ +10 if stage progression matches engagement
└─ -10 if stuck in "new" stage with existing notes

Final Score: Capped at 0-100
```

**Priority Tiers:**

| Tier | Score Range | Meaning |
|------|-------------|---------|
| Hot | 80-100 | High intent, immediate follow-up |
| Warm | 60-79 | Good fit, active nurturing |
| Cold | 40-59 | Low engagement, automated nurturing |
| Unlikely | 0-39 | Deprioritize, minimal effort |

**Implementation Location:** `src/lib/ai/scoring-engine.ts`

### Phase 3: API Endpoints

**New API route:** `GET/POST /api/v1/leads/[id]/insights`

**GET** — Retrieve cached insights
- Returns cached insights if valid (not expired)
- Returns `null` if no insights exist (trigger generation)

**POST** — Generate/refresh insights
- Query param `?force=true` to bypass cache
- Calculates score using scoring engine
- Generates summary and actions
- Stores in `lead_insights` table
- Updates `leads.ai_score` and `leads.ai_priority`

**Response Schema:**
```typescript
interface InsightsResponse {
  score: number;
  scoreLabel: "High" | "Medium" | "Low";
  priorityTier: "hot" | "warm" | "cold" | "unlikely";
  factors: Array<{
    label: string;
    impact: "positive" | "negative" | "neutral";
    points: number;
  }>;
  summary: string;
  actions: Array<{
    id: string;
    priority: "high" | "medium" | "low";
    title: string;
    description: string;
    actionType: "call" | "email" | "task" | "update";
  }>;
  engagement: {
    totalInteractions: number;
    lastInteraction: string;
    responseRate: string;
    avgResponseTime: string;
  };
  generatedAt: string;
  expiresAt: string;
  isStale: boolean;
}
```

### Phase 4: Event Triggers

**Automatic recalculation when:**

| Event | Trigger | Action |
|-------|---------|--------|
| Lead created | `lead.created` | Generate initial insights |
| Lead updated (key fields) | `lead.updated` | Recalculate if email, phone, stage changed |
| Note added | `note.created` | Recalculate engagement score |
| Stage changed | `lead.stage_changed` | Update priority tier |
| Checklist completed | `checklist.completed` | Update engagement stats |

**Implementation:** Add to existing event handlers in API routes.

### Phase 5: Frontend Integration

**Changes to `ai-insights-tab.tsx`:**

1. **On mount:** Fetch insights from API (`GET /api/v1/leads/[id]/insights`)
2. **If cached insights exist:** Display immediately
3. **If no insights:** Show loading state, call `POST` to generate
4. **"Regenerate" button:** Call `POST ?force=true`
5. **Stale indicator:** Show warning if `isStale: true`

**New behavior:**
```
Component mounts → GET /api/v1/leads/[id]/insights
  ├─ If insights exist → Display immediately (0ms delay)
  ├─ If insights expired → Display with "Stale" badge, auto-refresh in background
  └─ If no insights → Show skeleton, POST to generate, display when ready
```

### Phase 6: Batch Processing (Daily Job)

**Cron job:** Recalculate stale insights

```sql
-- Find leads with expired or missing insights
SELECT l.id, l.tenant_id
FROM leads l
LEFT JOIN lead_insights li ON l.id = li.lead_id
WHERE l.deleted_at IS NULL
  AND (li.id IS NULL OR li.expires_at < now())
ORDER BY l.updated_at DESC
LIMIT 1000;
```

**Implementation options:**
1. Supabase Edge Function with pg_cron
2. External cron service calling batch API endpoint
3. Vercel Cron (if using Vercel hosting)

---

## Adaptive Enhancements (Future)

### Phase 7: Outcome Tracking

Track conversion outcomes to measure scoring accuracy:

```sql
ALTER TABLE lead_insights ADD COLUMN predicted_outcome TEXT;
ALTER TABLE lead_insights ADD COLUMN actual_outcome TEXT;
ALTER TABLE lead_insights ADD COLUMN outcome_recorded_at TIMESTAMPTZ;
```

When lead reaches terminal stage (enrolled/rejected):
- Record actual outcome
- Calculate prediction accuracy over time
- Adjust weights based on what actually predicts conversions

### Phase 8: Tenant-Specific Tuning

Allow tenants to customize scoring weights:

```sql
CREATE TABLE tenant_scoring_config (
  tenant_id UUID PRIMARY KEY REFERENCES tenants(id),
  weights JSONB NOT NULL DEFAULT '{
    "contact_email": 15,
    "contact_phone": 15,
    "contact_location": 5,
    "engagement_note": 5,
    "engagement_recent": 10,
    "engagement_stale": -10,
    "completeness_custom_fields": 10,
    "completeness_contact_method": 5
  }',
  updated_at TIMESTAMPTZ DEFAULT now()
);
```

### Phase 9: ML Integration (When Ready)

**Prerequisites:**
- Tenant has 100+ conversions
- 6 months of engagement data

**Model options:**
1. Gradient Boosting (XGBoost) for tabular data
2. OpenAI embeddings for text analysis
3. Fine-tuned LLM for natural language insights

---

## Files to Create/Modify

### New Files

| File | Purpose |
|------|---------|
| `supabase/migrations/013_lead_insights.sql` | Database migration |
| `src/lib/ai/scoring-engine.ts` | Rule-based scoring logic |
| `src/lib/ai/insight-generator.ts` | Summary and action generation |
| `src/app/(main)/api/v1/leads/[id]/insights/route.ts` | API endpoint |
| `src/types/ai-insights.ts` | TypeScript types |

### Modified Files

| File | Changes |
|------|---------|
| `src/components/dashboard/lead/ai-insights-tab.tsx` | Load from API, remove mock generation |
| `src/app/(main)/api/v1/leads/route.ts` | Trigger insight generation on create |
| `src/app/(main)/api/v1/leads/[id]/route.ts` | Trigger recalculation on update |
| `src/types/database.ts` | Add LeadInsights type |

---

## Deliverables Summary

| Phase | Deliverable | Owner | Effort |
|-------|-------------|-------|--------|
| 1 | Migration: `lead_insights` table | DB Engineer | 1 day |
| 2 | Scoring engine function | API Dev | 2 days |
| 3 | API route: `/api/v1/leads/[id]/insights` | API Dev | 1 day |
| 4 | Event triggers for auto-recalculation | API Dev | 1 day |
| 5 | Update `ai-insights-tab.tsx` | Frontend Dev | 1 day |
| 6 | Batch job for stale insights | API Dev | 1 day |

**Total estimated effort:** 7 days

---

## Success Metrics

| Metric | Current | Target |
|--------|---------|--------|
| Page load time (AI tab) | 2+ seconds | <100ms |
| Regeneration on page load | 100% | 0% (cached) |
| Insights persistence | None | 24h TTL |
| Score accuracy | N/A (mock) | Track via outcomes |

---

## Appendix: Research Sources

- Salesforce Einstein Lead Scoring Documentation
- HubSpot Predictive Lead Scoring Guide
- HubSpot Engineering: Prediction Engine Architecture
- Microsoft Azure: Multi-tenant AI/ML Architecture
- Industry best practices for CRM lead scoring (2024-2026)

See full research report in `research-report.md`.
