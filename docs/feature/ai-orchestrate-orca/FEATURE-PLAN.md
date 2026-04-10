# Orca: AI Orchestration Platform

> **Feature Branch:** `feature/ai-orchestrate-orca`
> **Status:** Phase 1 Complete ✅
> **Created:** 2026-04-10
> **Phase 1 Completed:** 2026-04-10
> **Owner:** Zunkiree Labs

---

## Table of Contents

1. [Vision](#vision)
2. [Problem Statement](#problem-statement)
3. [Solution Overview](#solution-overview)
4. [Core Concepts](#core-concepts)
5. [Agent Fleet](#agent-fleet)
6. [Database Design](#database-design)
7. [UI/UX Specifications](#uiux-specifications)
8. [Implementation Phases](#implementation-phases)
9. [Success Metrics](#success-metrics)
10. [Future Roadmap](#future-roadmap)

---

## Vision

**Transform the Lead Gen CRM from a traditional software tool into an AI-native Organization Mission Control.**

In a traditional CRM:
- Humans execute every task
- 4+ layers of hierarchy
- 100% of time spent doing work
- Role: **Executor**

In an AI-native CRM (Orca):
- AI agents handle 80%+ of tasks
- 2 layers of hierarchy
- 96% of time spent reviewing and directing
- Role: **Orchestrator**

```
┌─────────────────────────────────────────────────────────────────┐
│                        THE TRANSFORMATION                        │
├────────────────────────────┬────────────────────────────────────┤
│      BEFORE (People)       │       AFTER (With Agents)          │
├────────────────────────────┼────────────────────────────────────┤
│  4 layers of hierarchy     │  2 layers (flat)                   │
│  0/25 tasks automated      │  24/25 tasks automated             │
│  100% time executing       │  96% time reviewing                │
│  Human = Executor          │  Human = Orchestrator              │
│  Reactive operations       │  Proactive AI assistance           │
└────────────────────────────┴────────────────────────────────────┘
```

**End Goal:** A CRM where AI agents are first-class team members, handling routine work autonomously while humans focus on strategy, relationships, and complex decisions.

---

## Problem Statement

### Current State (Traditional CRM)

1. **Manual Lead Processing**
   - Every lead requires human review
   - Qualification is subjective and inconsistent
   - Response times vary by counselor workload

2. **Repetitive Tasks**
   - Same follow-up emails written repeatedly
   - Manual document verification
   - Calendar coordination via email chains

3. **Scaling Challenges**
   - More leads = more staff needed
   - Quality drops as volume increases
   - Counselors burned out on admin work

4. **Data Entry Burden**
   - Manual status updates
   - Pipeline management is tedious
   - Reporting requires manual compilation

### Impact

| Metric | Traditional | Target with AI |
|--------|-------------|----------------|
| Lead response time | 24-48 hours | < 5 minutes |
| Qualification accuracy | 60-70% | 90%+ |
| Counselor capacity | 50 leads/person | 200+ leads/person |
| Time on admin tasks | 60% | 10% |
| Conversion rate | 10% | 15-20% |

---

## Solution Overview

### Orca: AI Orchestration Platform

Orca is a sub-system within the Lead Gen CRM that enables:

1. **Hybrid Organization Structure**
   - Roles can be filled by humans OR AI agents
   - Visual hierarchy showing the blended team
   - Toggle between "People" and "With Agents" views

2. **Task Automation Matrix**
   - Every task categorized by automation level
   - Green = Fully automated (agent end-to-end)
   - Orange = Agent + Human collaboration
   - Blue = Human-led (agent assists)

3. **Agent Fleet Management**
   - Pre-configured AI agents for common CRM tasks
   - Each agent has specific responsibilities
   - Agents work autonomously within defined scope

4. **Orchestrator Dashboard**
   - Stats: Tasks automated, human's week, role
   - Handoff visualization between roles
   - Performance metrics for agents

---

## Core Concepts

### 1. Role Types

Every position in the organization can be:

| Type | Icon | Description |
|------|------|-------------|
| **Human** | 👤 | Traditional team member |
| **Agent** | 🤖 | AI-powered autonomous worker |
| **Hybrid** | 👤🤖 | Human with agent assistance |

### 2. Automation Levels

Tasks are categorized by how much AI handles:

| Level | Color | Description | Example |
|-------|-------|-------------|---------|
| **Fully Automated** | 🟢 Green | Agent handles end-to-end | Lead scoring |
| **Agent + Human** | 🟠 Orange | Agent does work, human reviews | Email drafts |
| **Human-Led** | 🔵 Blue | Human decides, agent assists | Complex negotiations |

### 3. Organization Layers

| Layer | Traditional | AI-Native |
|-------|-------------|-----------|
| 1 | Executive | Orchestrators (humans) |
| 2 | Management | - |
| 3 | Supervisors | - |
| 4 | Individual Contributors | Specialist Agents (AI) |

AI-native organizations are **flatter** because agents handle coordination that previously required middle management.

### 4. The Toggle

The "People / With Agents" toggle is the key UX element:

```
┌─────────────────────────────────┐
│   [ People ]  [ With agents ]   │  ← Toggle switch
└─────────────────────────────────┘
```

- **People mode:** Shows traditional org structure, all tasks human-driven
- **With agents mode:** Shows AI-augmented structure, tasks color-coded by automation

This toggle demonstrates the transformation—same organization, radically different operation.

---

## Agent Fleet

### Overview

Six AI agents form the core fleet for Lead Gen CRM:

```
┌─────────────────────────────────────────────────────────────────┐
│                         AGENT FLEET                              │
├─────────────┬─────────────┬─────────────┬─────────────┬─────────┤
│   Lead      │  Outreach   │  Scheduler  │  Document   │ Pipeline│
│  Qualifier  │   Agent     │   Agent     │  Processor  │ Manager │
│     🎯      │     📧      │     📅      │     📄      │    🔄   │
├─────────────┼─────────────┼─────────────┼─────────────┼─────────┤
│  95% auto   │  80% auto   │  90% auto   │  85% auto   │ 90% auto│
└─────────────┴─────────────┴─────────────┴─────────────┴─────────┘
                              │
                    ┌─────────┴─────────┐
                    │   Insights Agent  │
                    │        📊         │
                    │     95% auto      │
                    └───────────────────┘
```

### Agent Specifications

#### 1. Lead Qualifier Agent 🎯

**Purpose:** Instantly score and classify incoming leads

| Attribute | Value |
|-----------|-------|
| Automation Level | 🟢 95% Fully Automated |
| Trigger | New lead submission |
| Output | Lead score (0-100), quality tag, priority flag |

**Responsibilities:**
- Analyze form data against ICP (Ideal Customer Profile)
- Assign score based on demographics + behavioral signals
- Classify as Hot (76+), Warm (51-75), Cold (0-50)
- Flag high-priority leads for immediate attention
- Detect and handle duplicates

**Human Involvement:**
- Review flagged edge cases
- Adjust scoring weights periodically
- Handle leads with incomplete data

---

#### 2. Outreach Agent 📧

**Purpose:** Automate personalized communication

| Attribute | Value |
|-----------|-------|
| Automation Level | 🟠 80% Agent + Human |
| Trigger | Stage change, time-based, lead activity |
| Output | Draft emails, follow-up sequences |

**Responsibilities:**
- Draft personalized initial outreach
- Execute follow-up sequences (Day 1, 3, 7, 14)
- Re-engage stale leads with new angles
- Classify responses (positive/negative/neutral)
- Route complex responses to human counselor

**Human Involvement:**
- Approve/edit sensitive communications
- Handle objections and negotiations
- Personal relationship building

---

#### 3. Scheduler Agent 📅

**Purpose:** Eliminate scheduling friction

| Attribute | Value |
|-----------|-------|
| Automation Level | 🟢 90% Fully Automated |
| Trigger | Lead requests meeting, stage progression |
| Output | Calendar invites, reminders |

**Responsibilities:**
- Check counselor availability
- Send booking links to leads
- Confirm appointments
- Send reminders (24h, 1h before)
- Handle rescheduling requests
- Follow up on no-shows

**Human Involvement:**
- Attend the actual meeting
- Handle complex scheduling conflicts

---

#### 4. Document Processor Agent 📄

**Purpose:** Automate document handling (key for education CRM)

| Attribute | Value |
|-----------|-------|
| Automation Level | 🟠 85% Agent + Human |
| Trigger | Document upload |
| Output | Verified documents, extracted data |

**Responsibilities:**
- Verify file type, size, completeness
- Extract data via OCR (transcripts, IDs, certificates)
- Cross-validate against form entries
- Auto-request missing documents
- Organize and tag files in storage

**Human Involvement:**
- Verify blurry or unclear documents
- Handle foreign credentials
- Make judgment calls on edge cases

---

#### 5. Pipeline Manager Agent 🔄

**Purpose:** Keep leads moving through the pipeline

| Attribute | Value |
|-----------|-------|
| Automation Level | 🟢 90% Fully Automated |
| Trigger | Activity detected, time elapsed |
| Output | Stage updates, reassignments, alerts |

**Responsibilities:**
- Auto-advance stages when criteria met
- Update status based on activity
- Flag stale leads (stuck > X days)
- Reassign unworked leads
- Archive dead leads
- Suggest lead merges

**Human Involvement:**
- Complex stage decisions
- Manual overrides when needed
- Strategic pipeline adjustments

---

#### 6. Insights Agent 📊

**Purpose:** Transform data into actionable intelligence

| Attribute | Value |
|-----------|-------|
| Automation Level | 🟢 95% Fully Automated |
| Trigger | Scheduled (daily/weekly), on-demand |
| Output | Reports, alerts, recommendations |

**Responsibilities:**
- Generate daily/weekly pipeline reports
- Detect anomalies (quality drops, unusual patterns)
- Forecast enrollment numbers
- Track counselor performance
- Recommend which leads to prioritize

**Human Involvement:**
- Act on insights
- Make strategic decisions
- Adjust forecasting models

---

### Agent Summary Matrix

| Agent | Tasks | Fully Auto | Agent+Human | Human-Led |
|-------|-------|------------|-------------|-----------|
| Lead Qualifier | 5 | 4 | 1 | 0 |
| Outreach | 5 | 2 | 3 | 0 |
| Scheduler | 6 | 5 | 1 | 0 |
| Document Processor | 5 | 3 | 2 | 0 |
| Pipeline Manager | 6 | 5 | 1 | 0 |
| Insights | 5 | 5 | 0 | 0 |
| **TOTAL** | **32** | **24** | **8** | **0** |

**Result:** 24/32 tasks fully automated, 8/32 with human review = **75% automation**

---

## Database Design

### New Tables

```sql
-- ============================================
-- ORCA: AI ORCHESTRATION SCHEMA
-- ============================================

-- Organization roles (can be human or AI agent)
CREATE TABLE org_roles (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,

  -- Role identity
  name TEXT NOT NULL,                      -- "Lead Qualifier", "Senior Counselor"
  slug TEXT NOT NULL,                      -- "lead-qualifier", "senior-counselor"
  description TEXT,                        -- "Scores and qualifies incoming leads"

  -- Role type
  role_type TEXT NOT NULL CHECK (role_type IN ('human', 'agent', 'hybrid')),

  -- Hierarchy
  layer INTEGER NOT NULL DEFAULT 1,        -- 1 = top, 2 = middle, etc.
  parent_role_id UUID REFERENCES org_roles(id) ON DELETE SET NULL,
  position INTEGER NOT NULL DEFAULT 0,     -- Order within layer

  -- For display
  color TEXT,                              -- Hex color for role card
  icon TEXT,                               -- Lucide icon name

  -- Metadata
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  UNIQUE(tenant_id, slug)
);

-- Role responsibilities (what this role does)
CREATE TABLE role_responsibilities (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  role_id UUID NOT NULL REFERENCES org_roles(id) ON DELETE CASCADE,

  name TEXT NOT NULL,                      -- "Score leads"
  description TEXT,                        -- "Analyze form data and assign score"

  position INTEGER NOT NULL DEFAULT 0,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Tasks owned by roles (with automation level)
CREATE TABLE role_tasks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  role_id UUID NOT NULL REFERENCES org_roles(id) ON DELETE CASCADE,

  -- Task identity
  name TEXT NOT NULL,                      -- "Score incoming leads"
  description TEXT,                        -- "Analyze form data against ICP"

  -- Automation classification
  automation_level TEXT NOT NULL CHECK (automation_level IN (
    'fully_automated',                     -- 🟢 Agent handles end-to-end
    'agent_human',                         -- 🟠 Agent + human collaboration
    'human_led'                            -- 🔵 Human-led, agent assists
  )),

  -- Descriptions for each mode
  agent_handles TEXT,                      -- "Analyzes data, assigns score"
  human_handles TEXT,                      -- "Reviews edge cases"

  -- Ordering
  position INTEGER NOT NULL DEFAULT 0,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- AI Agents registry
CREATE TABLE ai_agents (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,

  -- Agent identity
  name TEXT NOT NULL,                      -- "Lead Qualifier Agent"
  slug TEXT NOT NULL,                      -- "lead-qualifier"
  agent_type TEXT NOT NULL,                -- 'qualifier' | 'outreach' | 'scheduler' | 'document' | 'pipeline' | 'insights'
  description TEXT,

  -- Status
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'paused', 'error', 'disabled')),

  -- Configuration (preset for MVP)
  config JSONB NOT NULL DEFAULT '{}',      -- Model, prompts, triggers, permissions

  -- Statistics
  stats JSONB NOT NULL DEFAULT '{
    "tasks_completed": 0,
    "tasks_failed": 0,
    "avg_response_time_ms": 0,
    "last_active_at": null
  }',

  -- Assignment
  assigned_role_id UUID REFERENCES org_roles(id) ON DELETE SET NULL,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  UNIQUE(tenant_id, slug)
);

-- Role assignments (who fills each role)
CREATE TABLE role_assignments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  role_id UUID NOT NULL REFERENCES org_roles(id) ON DELETE CASCADE,

  -- Assignee (one of these must be set)
  user_id UUID REFERENCES auth.users(id) ON DELETE CASCADE,
  agent_id UUID REFERENCES ai_agents(id) ON DELETE CASCADE,

  -- Status
  is_active BOOLEAN NOT NULL DEFAULT TRUE,

  -- Dates
  assigned_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deactivated_at TIMESTAMPTZ,

  -- Ensure either user or agent is set, not both
  CHECK (
    (user_id IS NOT NULL AND agent_id IS NULL) OR
    (user_id IS NULL AND agent_id IS NOT NULL)
  )
);

-- Handoffs between roles (workflow connections)
CREATE TABLE role_handoffs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,

  -- Connection
  from_role_id UUID NOT NULL REFERENCES org_roles(id) ON DELETE CASCADE,
  to_role_id UUID NOT NULL REFERENCES org_roles(id) ON DELETE CASCADE,

  -- Handoff details
  trigger_description TEXT,                -- "Agent generates API contracts"

  position INTEGER NOT NULL DEFAULT 0,

  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  -- Prevent duplicate handoffs
  UNIQUE(from_role_id, to_role_id)
);

-- ============================================
-- INDEXES
-- ============================================

CREATE INDEX idx_org_roles_tenant ON org_roles(tenant_id);
CREATE INDEX idx_org_roles_parent ON org_roles(parent_role_id);
CREATE INDEX idx_org_roles_layer ON org_roles(tenant_id, layer);

CREATE INDEX idx_role_tasks_role ON role_tasks(role_id);
CREATE INDEX idx_role_tasks_automation ON role_tasks(automation_level);

CREATE INDEX idx_ai_agents_tenant ON ai_agents(tenant_id);
CREATE INDEX idx_ai_agents_type ON ai_agents(agent_type);
CREATE INDEX idx_ai_agents_status ON ai_agents(status);

CREATE INDEX idx_role_assignments_role ON role_assignments(role_id);
CREATE INDEX idx_role_assignments_user ON role_assignments(user_id);
CREATE INDEX idx_role_assignments_agent ON role_assignments(agent_id);

-- ============================================
-- RLS POLICIES
-- ============================================

ALTER TABLE org_roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE role_responsibilities ENABLE ROW LEVEL SECURITY;
ALTER TABLE role_tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE ai_agents ENABLE ROW LEVEL SECURITY;
ALTER TABLE role_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE role_handoffs ENABLE ROW LEVEL SECURITY;

-- org_roles policies
CREATE POLICY "Users can view org roles in their tenant"
  ON org_roles FOR SELECT
  USING (tenant_id IN (SELECT get_user_tenant_ids()));

CREATE POLICY "Admins can manage org roles"
  ON org_roles FOR ALL
  USING (is_tenant_admin(tenant_id));

-- Similar policies for other tables...
-- (Following the same pattern as existing RLS)
```

### Default Agent Seed Data

```sql
-- Seed default agents for each tenant (run after tenant creation)
INSERT INTO ai_agents (tenant_id, name, slug, agent_type, description, config) VALUES
  -- Lead Qualifier
  ($tenant_id, 'Lead Qualifier', 'lead-qualifier', 'qualifier',
   'Instantly scores and classifies incoming leads based on ICP fit',
   '{"automation_level": 0.95, "triggers": ["lead.created"]}'
  ),

  -- Outreach Agent
  ($tenant_id, 'Outreach Agent', 'outreach', 'outreach',
   'Automates personalized email communication and follow-ups',
   '{"automation_level": 0.80, "triggers": ["lead.stage_changed", "schedule.followup"]}'
  ),

  -- Scheduler Agent
  ($tenant_id, 'Scheduler', 'scheduler', 'scheduler',
   'Handles appointment booking, reminders, and rescheduling',
   '{"automation_level": 0.90, "triggers": ["lead.requested_meeting", "calendar.event"]}'
  ),

  -- Document Processor
  ($tenant_id, 'Document Processor', 'document-processor', 'document',
   'Verifies uploads, extracts data, and requests missing documents',
   '{"automation_level": 0.85, "triggers": ["document.uploaded"]}'
  ),

  -- Pipeline Manager
  ($tenant_id, 'Pipeline Manager', 'pipeline-manager', 'pipeline',
   'Keeps leads moving through stages and handles reassignments',
   '{"automation_level": 0.90, "triggers": ["lead.updated", "schedule.stale_check"]}'
  ),

  -- Insights Agent
  ($tenant_id, 'Insights', 'insights', 'insights',
   'Generates reports, detects anomalies, and provides recommendations',
   '{"automation_level": 0.95, "triggers": ["schedule.daily", "schedule.weekly"]}'
  );
```

---

## UI/UX Specifications

### Screen Architecture (6 Screens)

The Orca feature is organized into 6 separate, scalable screens:

| Screen | Path | Purpose | Status |
|--------|------|---------|--------|
| **Overview** | `/orca` | Dashboard with stats, quick actions, activity feed | ✅ Complete |
| **Org. Structure** | `/orca/structure` | Visual org chart editor with drag-and-drop layers | ✅ Complete |
| **Roles** | `/orca/roles` | Role management list with CRUD operations | ✅ Complete |
| **Tasks** | `/orca/tasks` | Task matrix with automation level filtering | ✅ Complete |
| **Agents** | `/orca/agents` | Agent fleet management with status controls | ✅ Complete |
| **Compare** | `/orca/compare` | Transformation view with People/Agents toggle | ✅ Complete |

### Sidebar Navigation

```
Orca (AI Orchestration)  ← Red CTA with shimmer animation
├── Overview
├── Org. Structure
├── Roles
├── Tasks
├── Agents
└── Compare
```

- Expandable nav item with curved connector lines (like agentic-commerce)
- Sub-items visible when expanded
- Active state highlighting

---

### Screen 1: Overview (`/orca`)

Dashboard providing at-a-glance status of the AI orchestration system.

**Components:**
- Stats row: Active Agents, Automated Tasks, Success Rate
- Quick Actions: Add Role, Add Agent, Configure, View Reports
- Activity Feed: Recent agent actions with timestamps
- Getting Started Guide: 4-step onboarding checklist

---

### Screen 2: Org. Structure (`/orca/structure`)

Visual org chart editor for building the hybrid human+AI hierarchy. **Features dual view modes.**

**View Toggle** (left of Add Layer button):
- **Editor View** (List icon): Card-based layer editor with full controls
- **Hierarchy View** (GitBranch icon): Centered tree visualization

**Editor View Components:**
- Layer cards with headers (Layer 1, Layer 2, etc.)
- Move Up/Down arrows for layer reordering
- Edit/Delete layer controls
- Role cards within each layer showing:
  - Role name and type icon (human/agent/hybrid)
  - Type badge (human/agent/Human + Agent)
  - Add/Delete controls
- "Add Role" placeholder in each layer
- "Add Layer Below" button

**Hierarchy View Components:**
- Centered tree layout with connecting lines
- Layer labels as section headers (Leadership, Specialists)
- Role cards arranged horizontally within each layer
- Agent count dots (●●●) below each role
- Role descriptions below cards
- Summary badge showing total layers
- Same editing capabilities (add/edit/delete)

**Both views share the same data** - changes sync instantly between views.

**Role Type Legend:**
- White border: Human Role
- Green border: Agent Role
- Amber border: Hybrid (Human + Agent)

---

### Screen 3: Roles (`/orca/roles`)

Role management with filtering and search.

**Components:**
- Search input
- Filter pills: All, Human, Agent, Hybrid
- Role cards showing:
  - Name and type badge
  - Description
  - Assigned to (user/agent name)
  - Task count
  - Actions: Edit, Delete, View Tasks

---

### Screen 4: Tasks (`/orca/tasks`)

Task matrix showing all tasks with automation classification.

**Components:**
- Filter dropdowns: Automation Level, Role
- Task cards with:
  - Color-coded left border (green/orange/blue)
  - Task name
  - Role assignment
  - Agent handles / Human handles descriptions
- Legend for automation levels

---

### Screen 5: Agents (`/orca/agents`)

Agent fleet management for monitoring and controlling AI workers.

**Components:**
- Stats row: Active Agents, Tasks Completed, Avg Success Rate
- Search input
- Status filter pills: All, Active, Paused, Disabled
- Agent cards showing:
  - Icon based on agent type
  - Name and status badge
  - Description
  - Stats: Tasks completed, Success rate, Last active
  - Play/Pause toggle button
  - Assigned role
  - Settings and Logs action buttons

---

### Screen 6: Compare (`/orca/compare`)

Transformation view demonstrating the impact of AI orchestration.

**Components:**
- **Mode Toggle:** People / With agents (pill-style)
- **Info Banner:** Explains presentation mode usage
- **Stats Cards:** Tasks automated, Human's week %, Human's role
- **Tasks Matrix:** 5 role columns × 5 task rows with color coding
- **Handoffs Flow:** Horizontal diagram showing role-to-role handoffs
- **Org Hierarchy:** Layer visualization with role cards

#### Mode Toggle Behavior

```
┌─────────────────────────────────┐
│   [ People ]  [ With agents ]   │
└─────────────────────────────────┘
```

- **People mode:** Traditional view, all tasks human-driven, 4 layers
- **With agents mode:** AI-augmented view, color-coded automation, 2 layers

---

## Implementation Phases

### Phase 1: UI Shell (Static Data) ✅ COMPLETE
**Completed:** 2026-04-10
**Goal:** Prove the concept visually with 6 separate, scalable screens

#### Deliverables:
- [x] Sidebar navigation with expandable Orca section + shimmer animation
- [x] 6 sub-pages: Overview, Org. Structure, Roles, Tasks, Agents, Compare
- [x] Toggle component (People / With Agents) on Compare page
- [x] **Org. Structure dual view toggle** (Editor / Hierarchy views)
- [x] Tasks by Role matrix (static data)
- [x] Stats cards (hardcoded values)
- [x] Handoffs flow visualization
- [x] Organization hierarchy visual (editable in both views)
- [x] Agent fleet management UI
- [x] Role management UI
- [x] Task management UI
- [x] Build passes ✅

#### Files Created:
```
src/
├── app/(main)/(dashboard)/orca/
│   ├── page.tsx                      # Overview dashboard
│   ├── structure/page.tsx            # Org chart editor
│   ├── roles/page.tsx                # Role management
│   ├── tasks/page.tsx                # Task matrix
│   ├── agents/page.tsx               # Agent fleet
│   └── compare/page.tsx              # Transformation view
└── components/dashboard/orca/
    ├── types.ts                      # TypeScript interfaces
    ├── mode-toggle.tsx               # People/Agents toggle
    ├── tasks-matrix.tsx              # Tasks by role grid
    ├── stats-cards.tsx               # Stat cards
    ├── handoffs-flow.tsx             # Role handoff diagram
    ├── org-hierarchy.tsx             # Visual org chart
    ├── overview-content.tsx          # Overview dashboard
    ├── structure-content.tsx         # Org chart editor
    ├── roles-content.tsx             # Role management
    ├── tasks-content.tsx             # Task management
    ├── agents-content.tsx            # Agent fleet
    └── compare-content.tsx           # Transformation view
```

#### Also Modified:
- `src/components/dashboard/shell.tsx` — Added expandable Orca nav
- `src/app/globals.css` — Added cta-shimmer animation

---

### Phase 2: Database Schema
**Status:** 🔲 Pending
**Goal:** Enable persistence

#### Deliverables:
- [ ] Create migration file `009_orca_ai_orchestration.sql`
- [ ] Add RLS policies for all new tables
- [ ] Seed default agents per tenant
- [ ] Add TypeScript types in `src/types/orca.ts`

#### Migration File:
```
supabase/migrations/
└── 009_orca_ai_orchestration.sql
```

#### Tables to Create:
- `org_layers` — Organization hierarchy layers
- `org_roles` — Roles within layers (human/agent/hybrid)
- `role_responsibilities` — Responsibilities per role
- `role_tasks` — Tasks with automation levels
- `ai_agents` — Agent registry per tenant
- `role_assignments` — User/agent to role mapping
- `role_handoffs` — Workflow connections between roles

---

### Phase 3: CRUD Operations
**Status:** 🔲 Pending
**Goal:** Make it functional

#### Deliverables:
- [ ] API routes for org_layers (GET, POST, PUT, DELETE, reorder)
- [ ] API routes for org_roles (GET, POST, PUT, DELETE)
- [ ] API routes for role_tasks (GET, POST, PUT, DELETE)
- [ ] API routes for ai_agents (GET, POST, PUT, PATCH status)
- [ ] API routes for role_assignments (GET, POST, DELETE)
- [ ] Wire Org. Structure screen to create/edit/delete layers and roles
- [ ] Wire Roles screen to manage roles
- [ ] Wire Tasks screen to assign tasks with automation levels
- [ ] Wire Agents screen to manage agent status

#### API Routes:
```
src/app/(main)/api/v1/orca/
├── layers/
│   ├── route.ts           # GET, POST
│   ├── [id]/route.ts      # GET, PUT, DELETE
│   └── reorder/route.ts   # POST (move up/down)
├── roles/
│   ├── route.ts           # GET, POST
│   └── [id]/route.ts      # GET, PUT, DELETE
├── tasks/
│   ├── route.ts           # GET, POST
│   └── [id]/route.ts      # GET, PUT, DELETE
├── agents/
│   ├── route.ts           # GET, POST
│   └── [id]/
│       ├── route.ts       # GET, PUT, DELETE
│       └── status/route.ts # PATCH (pause/resume)
└── assignments/
    ├── route.ts           # GET, POST
    └── [id]/route.ts      # DELETE
```

---

### Phase 4: Dynamic Stats & Toggle
**Status:** 🔲 Pending
**Goal:** Calculate real stats and enable mode switching

#### Deliverables:
- [ ] Calculate automation stats from database
- [ ] Compare screen toggle switches views dynamically
- [ ] People mode shows traditional org (all human, more layers)
- [ ] Agents mode shows AI-augmented org (color-coded tasks, flat structure)
- [ ] Smooth CSS transitions between modes
- [ ] Overview dashboard shows live stats

#### Implementation:
```typescript
// Fetch and compute stats from database
const stats = await getOrcaStats(tenantId);

// Compare mode switches display based on state
const displayStats = mode === 'agents' ? stats : {
  ...stats,
  fullyAutomated: 0,
  agentHuman: 0,
  humansWeekPercent: 100,
  humansRole: 'Executor'
};
```

---

### Phase 5: Agent Wiring (Future)
**Duration:** TBD
**Goal:** Make agents actually work

#### Deliverables:
- [ ] Connect Lead Qualifier to lead.created webhook
- [ ] Implement scoring logic
- [ ] Connect Pipeline Manager to lead events
- [ ] Connect Document Processor to file uploads
- [ ] Add agent activity logging
- [ ] Add agent error handling

**Note:** This phase involves actual AI integration (OpenAI/Claude API) and is out of scope for MVP.

---

## Success Metrics

### Phase 1 (UI Shell) ✅ COMPLETE
- [x] 6 screens created and accessible via sidebar nav
- [x] Toggle switches between modes on Compare screen
- [x] **Org. Structure view toggle** (Editor / Hierarchy) works
- [x] All components render correctly
- [x] Expandable sidebar nav with curved connectors
- [x] Shimmer animation on Orca nav item
- [x] Build passes without errors

### Phase 2-4 (Functional)
- [ ] Layers can be created/edited/deleted/reordered
- [ ] Roles can be created/edited/deleted within layers
- [ ] Tasks can be assigned to roles with automation levels
- [ ] Agents can be paused/resumed/configured
- [ ] Stats calculate correctly from database
- [ ] Handoffs visualize based on actual role connections

### Phase 5 (AI Active)
- [ ] Lead Qualifier scores leads automatically on submission
- [ ] Pipeline Manager moves leads through stages
- [ ] Outreach Agent drafts personalized emails
- [ ] Scheduler Agent books meetings
- [ ] Response time < 5 seconds
- [ ] 90%+ accuracy on lead scoring

---

## Future Roadmap

### V2 Features
1. **Agent Configuration UI**
   - Customize agent prompts
   - Adjust scoring weights
   - Set trigger conditions

2. **Agent Activity Log**
   - See what each agent did
   - Audit trail for compliance
   - Debug failed actions

3. **Agent Performance Dashboard**
   - Tasks completed over time
   - Success/failure rates
   - Response time trends

### V3 Features
1. **Custom Agent Creation**
   - Build new agents from templates
   - Define custom triggers
   - Set custom actions

2. **Workflow Builder**
   - Visual drag-and-drop workflow
   - Connect agents in sequences
   - Conditional branching

3. **Multi-Tenant Agent Marketplace**
   - Share agent configurations
   - Import community agents
   - Rate and review agents

---

## Appendix

### A. Color Palette

| Purpose | Color | Hex |
|---------|-------|-----|
| Orca brand | Red | #eb1600 |
| Fully automated | Green | #10b981 |
| Agent + human | Orange | #f59e0b |
| Human-led | Blue | #3b82f6 |
| Toggle active | Teal | #4a9d7c |
| Background | Light gray | #f7f7f7 |

### B. Icon Mapping

| Role Type | Icon |
|-----------|------|
| Human | 👤 (User) |
| Agent | 🤖 (Bot) |
| Hybrid | 👤🤖 (Both) |
| Lead Qualifier | 🎯 (Target) |
| Outreach | 📧 (Mail) |
| Scheduler | 📅 (Calendar) |
| Document | 📄 (FileText) |
| Pipeline | 🔄 (RefreshCw) |
| Insights | 📊 (BarChart) |

### C. Related Documents

- [CLAUDE.md](/CLAUDE.md) - Project overview
- [Database Schema](/supabase/migrations/) - All migrations
- [API Patterns](/src/lib/api/) - API utilities

### D. Phase 1 Components

| Component | Path | Description |
|-----------|------|-------------|
| Overview | `/src/components/dashboard/orca/overview-content.tsx` | Dashboard with stats and quick actions |
| Org. Structure | `/src/components/dashboard/orca/structure-content.tsx` | Visual org chart editor |
| Roles | `/src/components/dashboard/orca/roles-content.tsx` | Role management list |
| Tasks | `/src/components/dashboard/orca/tasks-content.tsx` | Task matrix with automation levels |
| Agents | `/src/components/dashboard/orca/agents-content.tsx` | Agent fleet management |
| Compare | `/src/components/dashboard/orca/compare-content.tsx` | Transformation view with toggle |
| Types | `/src/components/dashboard/orca/types.ts` | Shared TypeScript interfaces |
| Mode Toggle | `/src/components/dashboard/orca/mode-toggle.tsx` | People/Agents toggle component |
| Stats Cards | `/src/components/dashboard/orca/stats-cards.tsx` | Stats display cards |
| Tasks Matrix | `/src/components/dashboard/orca/tasks-matrix.tsx` | Tasks by role grid |
| Handoffs Flow | `/src/components/dashboard/orca/handoffs-flow.tsx` | Role handoff diagram |
| Org Hierarchy | `/src/components/dashboard/orca/org-hierarchy.tsx` | Organization structure visual |

---

**Document Version:** 1.1
**Last Updated:** 2026-04-10
**Phase 1 Complete:** 2026-04-10
**Author:** Claude (AI Assistant) + Zunkiree Labs Team

### Changelog

| Version | Date | Changes |
|---------|------|---------|
| 1.1 | 2026-04-10 | Phase 1 complete. Updated architecture to 6 separate screens. Updated file structure. |
| 1.0 | 2026-04-10 | Initial planning document created. |
