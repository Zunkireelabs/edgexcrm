# Multi-Pipeline System - Feature Plan

> **Branch:** `feature/upgrade-pipeline`
> **Status:** In Progress
> **Created:** 2026-04-11
> **Updated:** 2026-04-11

---

## Overview

Transform the current single-pipeline system into a multi-pipeline system where:
- Each tenant can have multiple pipelines (Sales, Product Deals, Partnerships, etc.)
- Each pipeline has its own independent stages
- Users can create, rename, delete pipelines and manage their stages
- Works across all industry types (education, IT agency, real estate, etc.)

### Current State
```
1 tenant → 1 implicit pipeline → N stages (new, contacted, enrolled, rejected)
```

### Target State
```
1 tenant → N pipelines → Each pipeline has M independent stages
```

**Example for IT Agency:**
| Pipeline | Stages |
|----------|--------|
| **Sales Pipeline** | New → Discovery Call → Proposal Sent → Negotiation → Won → Lost |
| **Product Deal Pipeline** | Lead → Contract Sent → Client Onboarded → Active |
| **Partnership Pipeline** | Initial Contact → Evaluation → Agreement → Active Partner |

---

## UI Design

### Pipeline Page Header Layout

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                                                                             │
│  Pipeline   [Sales Pipeline ▾]  [⚙️]  [+]                                  │
│             ↑                    ↑     ↑                                    │
│             │                    │     └─ Create new pipeline               │
│             │                    └─ Pipeline settings (rename, stages)      │
│             └─ Dropdown to switch pipelines                                 │
│                                                                             │
│  500 Leads   🔍 Search leads...                    Sort   Export   +Add Lead│
│                                                                             │
│  [All Counselors ▾]  [All Sources ▾]  [Any time ▾]                         │
│                                                                             │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐     │
│  │● New 497 │  │● Discov 3│  │● Proposal│  │● Negot   │  │● Won     │     │
│  │          │  │          │  │          │  │          │  │          │     │
│  └──────────┘  └──────────┘  └──────────┘  └──────────┘  └──────────┘     │
└─────────────────────────────────────────────────────────────────────────────┘
```

**Key placement:** Pipeline selector is inline with the "Pipeline" heading, not a separate row.

### Pipeline Selector Dropdown

```
┌────────────────────────────────┐
│  Sales Pipeline         ✓ 500 │  <- Current (checkmark + lead count)
│  Product Deals             12 │
│  Partnership Pipeline       0 │
│  ────────────────────────────│
│  ⚙️ Manage All Pipelines      │
└────────────────────────────────┘
```

### Pipeline Settings Modal (⚙️)

```
┌─────────────────────────────────────────────────────────────────┐
│  Pipeline Settings                                        [×]   │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  Pipeline Name                                                  │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │ Sales Pipeline                                          │   │
│  └─────────────────────────────────────────────────────────┘   │
│                                                                 │
│  ☐ Set as default pipeline                                     │
│                                                                 │
│  ─────────────────────────────────────────────────────────────  │
│                                                                 │
│  Stages (drag to reorder)                                       │
│                                                                 │
│  ☰  🔵 New            [Default]                    [✏️] [🗑]   │
│  ☰  🟠 Discovery Call                              [✏️] [🗑]   │
│  ☰  🟣 Proposal Sent                               [✏️] [🗑]   │
│  ☰  🟡 Negotiation                                 [✏️] [🗑]   │
│  ☰  🟢 Won            [Won ✓]                      [✏️] [🗑]   │
│  ☰  🔴 Lost           [Lost ✓]                     [✏️] [🗑]   │
│                                                                 │
│  [+ Add Stage]                                                  │
│                                                                 │
├─────────────────────────────────────────────────────────────────┤
│                              [Delete Pipeline]    [Save Changes]│
└─────────────────────────────────────────────────────────────────┘
```

### Stage Edit (inline or popover)

```
┌─────────────────────────────────────────┐
│  Stage Name                             │
│  ┌───────────────────────────────────┐ │
│  │ Discovery Call                    │ │
│  └───────────────────────────────────┘ │
│                                         │
│  Color                                  │
│  [🔵][🟢][🟡][🟠][🔴][🟣][⚫][⚪]      │
│                                         │
│  Type                                   │
│  ○ Regular   ○ Won (terminal)           │
│  ○ Lost (terminal)                      │
│                                         │
│                    [Cancel]  [Save]     │
└─────────────────────────────────────────┘
```

### Create Pipeline Modal ([+])

```
┌─────────────────────────────────────────────────────────────────┐
│  Create New Pipeline                                      [×]   │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  Pipeline Name                                                  │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │ Product Deals                                           │   │
│  └─────────────────────────────────────────────────────────┘   │
│                                                                 │
│  Start with                                                     │
│  ○ Default stages (New, Contacted, Won, Lost)                   │
│  ○ Copy from existing pipeline: [Sales Pipeline ▾]              │
│  ○ Empty (add stages manually)                                  │
│                                                                 │
│                                          [Cancel]  [Create]     │
└─────────────────────────────────────────────────────────────────┘
```

---

## Database Schema

### New Table: `pipelines`

```sql
CREATE TABLE pipelines (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name VARCHAR(100) NOT NULL,
  slug VARCHAR(100) NOT NULL,
  description TEXT,
  is_default BOOLEAN DEFAULT false,
  position INTEGER NOT NULL DEFAULT 0,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(tenant_id, slug)
);

-- Indexes
CREATE INDEX idx_pipelines_tenant_id ON pipelines(tenant_id);
CREATE INDEX idx_pipelines_is_default ON pipelines(tenant_id, is_default) WHERE is_default = true;

-- Trigger for updated_at
CREATE TRIGGER trigger_pipelines_updated_at
  BEFORE UPDATE ON pipelines
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
```

### Modified: `pipeline_stages`

```sql
-- Add pipeline_id column
ALTER TABLE pipeline_stages
  ADD COLUMN pipeline_id UUID REFERENCES pipelines(id) ON DELETE CASCADE;

-- Drop old unique constraint (slug per tenant)
ALTER TABLE pipeline_stages
  DROP CONSTRAINT IF EXISTS pipeline_stages_tenant_id_slug_key;

-- Add new unique constraint (slug per pipeline)
ALTER TABLE pipeline_stages
  ADD CONSTRAINT pipeline_stages_pipeline_id_slug_key UNIQUE(pipeline_id, slug);

-- Add terminal_type to distinguish won vs lost
ALTER TABLE pipeline_stages
  ADD COLUMN terminal_type VARCHAR(10) CHECK (terminal_type IN ('won', 'lost'));

-- Index for pipeline lookups
CREATE INDEX idx_pipeline_stages_pipeline_id ON pipeline_stages(pipeline_id);
```

### Modified: `leads`

```sql
-- Add pipeline_id column
ALTER TABLE leads
  ADD COLUMN pipeline_id UUID REFERENCES pipelines(id);

-- Index for pipeline filtering
CREATE INDEX idx_leads_pipeline_id ON leads(pipeline_id);
```

### Data Migration

```sql
-- 1. Create default pipeline for each tenant
INSERT INTO pipelines (tenant_id, name, slug, is_default, position)
SELECT id, 'Default Pipeline', 'default', true, 0
FROM tenants
ON CONFLICT DO NOTHING;

-- 2. Link existing stages to the default pipeline
UPDATE pipeline_stages ps
SET pipeline_id = p.id
FROM pipelines p
WHERE ps.tenant_id = p.tenant_id AND p.is_default = true
  AND ps.pipeline_id IS NULL;

-- 3. Link existing leads to the default pipeline
UPDATE leads l
SET pipeline_id = p.id
FROM pipelines p
WHERE l.tenant_id = p.tenant_id AND p.is_default = true
  AND l.pipeline_id IS NULL;

-- 4. Set terminal_type based on existing is_terminal and slug
UPDATE pipeline_stages
SET terminal_type = CASE
  WHEN slug IN ('won', 'enrolled', 'hired', 'closed-won') THEN 'won'
  WHEN slug IN ('lost', 'rejected', 'closed-lost', 'withdrawn') THEN 'lost'
  WHEN is_terminal = true THEN 'lost'  -- Default terminal to lost if unclear
  ELSE NULL
END
WHERE is_terminal = true;

-- 5. Make pipeline_id NOT NULL after migration
ALTER TABLE pipeline_stages ALTER COLUMN pipeline_id SET NOT NULL;
ALTER TABLE leads ALTER COLUMN pipeline_id SET NOT NULL;
```

### RLS Policies

```sql
-- Enable RLS
ALTER TABLE pipelines ENABLE ROW LEVEL SECURITY;

-- View: tenant members
CREATE POLICY "Tenant members can view pipelines" ON pipelines
  FOR SELECT USING (tenant_id IN (SELECT get_user_tenant_ids()));

-- Insert: admins only
CREATE POLICY "Admins can insert pipelines" ON pipelines
  FOR INSERT WITH CHECK (is_tenant_admin(tenant_id));

-- Update: admins only
CREATE POLICY "Admins can update pipelines" ON pipelines
  FOR UPDATE USING (is_tenant_admin(tenant_id));

-- Delete: admins only
CREATE POLICY "Admins can delete pipelines" ON pipelines
  FOR DELETE USING (is_tenant_admin(tenant_id));
```

---

## API Endpoints

| Method | Endpoint | Purpose | Auth |
|--------|----------|---------|------|
| GET | `/api/v1/pipelines` | List all pipelines for tenant | Member |
| POST | `/api/v1/pipelines` | Create new pipeline | Admin |
| GET | `/api/v1/pipelines/:id` | Get pipeline with stages | Member |
| PATCH | `/api/v1/pipelines/:id` | Update pipeline (name, default) | Admin |
| DELETE | `/api/v1/pipelines/:id` | Delete pipeline (if no leads) | Admin |
| POST | `/api/v1/pipelines/:id/stages` | Add stage to pipeline | Admin |
| PATCH | `/api/v1/pipelines/:id/stages/:stageId` | Update stage | Admin |
| DELETE | `/api/v1/pipelines/:id/stages/:stageId` | Delete stage (if no leads) | Admin |
| POST | `/api/v1/pipelines/:id/stages/reorder` | Bulk reorder stages | Admin |

### API Response Formats

**GET /api/v1/pipelines**
```json
{
  "data": [
    {
      "id": "uuid",
      "name": "Sales Pipeline",
      "slug": "sales-pipeline",
      "is_default": true,
      "position": 0,
      "lead_count": 500,
      "stage_count": 6
    }
  ]
}
```

**GET /api/v1/pipelines/:id**
```json
{
  "data": {
    "id": "uuid",
    "name": "Sales Pipeline",
    "slug": "sales-pipeline",
    "is_default": true,
    "position": 0,
    "stages": [
      {
        "id": "uuid",
        "name": "New",
        "slug": "new",
        "position": 0,
        "color": "#3b82f6",
        "is_default": true,
        "is_terminal": false,
        "terminal_type": null,
        "lead_count": 497
      }
    ]
  }
}
```

**POST /api/v1/pipelines**
```json
{
  "name": "Product Deals",
  "template": "default" | "copy" | "empty",
  "copy_from_id": "uuid"  // if template === "copy"
}
```

---

## TypeScript Types

```typescript
// New: Pipeline
export interface Pipeline {
  id: string;
  tenant_id: string;
  name: string;
  slug: string;
  description: string | null;
  is_default: boolean;
  position: number;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

// Extended: Pipeline with stages and counts
export interface PipelineWithStages extends Pipeline {
  stages: PipelineStage[];
  lead_count: number;
}

// Updated: PipelineStage (add pipeline_id and terminal_type)
export interface PipelineStage {
  id: string;
  tenant_id: string;
  pipeline_id: string;  // NEW
  name: string;
  slug: string;
  position: number;
  color: string;
  is_default: boolean;
  is_terminal: boolean;
  terminal_type: 'won' | 'lost' | null;  // NEW
  created_at: string;
  updated_at: string;
}

// Extended: Stage with lead count (for settings UI)
export interface PipelineStageWithCount extends PipelineStage {
  lead_count: number;
}

// Updated: Lead (add pipeline_id)
export interface Lead {
  // ... existing fields
  pipeline_id: string;  // NEW
  stage_id: string | null;
}
```

---

## Implementation Phases

### Phase 1: Database & Migration ✅ COMPLETE
- [x] Create migration file `016_multi_pipeline.sql`
- [x] Create `pipelines` table
- [x] Add `pipeline_id` to `pipeline_stages`
- [x] Add `pipeline_id` to `leads`
- [x] Add `terminal_type` to `pipeline_stages`
- [x] Migrate existing data (create default pipeline per tenant)
- [x] Add RLS policies
- [x] Update TypeScript types in `src/types/database.ts`

### Phase 2: Backend APIs ✅ COMPLETE
- [x] `GET /api/v1/pipelines` - List pipelines with counts
- [x] `POST /api/v1/pipelines` - Create pipeline (with template options)
- [x] `GET /api/v1/pipelines/:id` - Get pipeline with stages
- [x] `PATCH /api/v1/pipelines/:id` - Update pipeline
- [x] `DELETE /api/v1/pipelines/:id` - Delete pipeline (with validation)
- [x] `POST /api/v1/pipelines/:id/stages` - Add stage
- [x] `PATCH /api/v1/pipelines/:id/stages/:stageId` - Update stage
- [x] `DELETE /api/v1/pipelines/:id/stages/:stageId` - Delete stage
- [x] `POST /api/v1/pipelines/:id/stages/reorder` - Reorder stages
- [x] Update `getPipelineStages()` to accept pipeline_id
- [x] Update `getLeadsForPipeline()` to filter by pipeline_id
- [x] Update leads POST to include pipeline_id

### Phase 3: Frontend - Pipeline Selector ✅ COMPLETE
- [x] Create `PipelineSelector.tsx` component
  - Dropdown to switch pipelines
  - Settings button (⚙️)
  - Create pipeline button (+)
- [x] Update pipeline page layout (inline selector with heading)
- [x] Store selected pipeline in URL param (`?pipeline=uuid`)
- [x] Filter kanban board by selected pipeline
- [x] Show pipeline-specific lead count

### Phase 4: Frontend - Pipeline Settings Modal ✅ COMPLETE
- [x] Create `PipelineSettingsModal.tsx` component
  - Pipeline name editor
  - Set as default checkbox
  - Stage list with drag-and-drop reorder (dnd-kit)
  - Delete pipeline button
- [x] Create `StageEditor.tsx` component
  - Name input
  - Color picker
  - Terminal type selector (regular/won/lost)
- [x] Handle stage CRUD operations
- [x] Validation feedback (cannot delete with leads, etc.)

### Phase 5: Frontend - Create Pipeline Modal ✅ COMPLETE
- [x] Create `CreatePipelineModal.tsx` component
  - Pipeline name input
  - Template options (default/copy/empty)
  - Pipeline selector for "copy from"
- [x] Handle create action
- [x] Auto-select new pipeline after creation

### Phase 6: Polish & Edge Cases ✅ COMPLETE
- [x] Handle empty state (no pipelines)
- [x] Remember last selected pipeline (localStorage)
- [x] Handle loading states (already in components)
- [x] Error handling and toast notifications (already implemented)
- [x] Update Add Lead sheet to use current pipeline
- [ ] Realtime updates for pipeline changes (future enhancement)

---

## Validation Rules

| Rule | Implementation |
|------|----------------|
| Pipeline must have at least 1 stage | Block deletion of last stage |
| Pipeline must have at least 1 won + 1 lost stage | Validate on save |
| Cannot delete pipeline with leads | Show error + lead count |
| Cannot delete stage with leads | Show error + lead count |
| One default pipeline per tenant | Unset old when setting new |
| Unique pipeline name per tenant | DB constraint + form validation |
| Unique stage slug per pipeline | DB constraint |

---

## Edge Cases

| Scenario | Behavior |
|----------|----------|
| New lead created | Assign to default pipeline + default stage |
| Pipeline deleted | Block if has leads (must move leads first) |
| Stage deleted | Block if has leads (must move leads first) |
| Switch pipeline in UI | Reload stages and leads for new pipeline |
| Form submission | Route to default pipeline (future: form-specific routing) |
| No pipelines exist | Auto-create "Default Pipeline" with basic stages |
| Last pipeline | Cannot delete the last pipeline |
| Last won/lost stage | Cannot delete if it's the only won/lost stage |

---

## Files to Create

```
supabase/migrations/009_multi_pipeline.sql

src/app/(main)/api/v1/pipelines/route.ts
src/app/(main)/api/v1/pipelines/[id]/route.ts
src/app/(main)/api/v1/pipelines/[id]/stages/route.ts
src/app/(main)/api/v1/pipelines/[id]/stages/[stageId]/route.ts
src/app/(main)/api/v1/pipelines/[id]/stages/reorder/route.ts

src/components/pipeline/PipelineSelector.tsx
src/components/pipeline/PipelineSettingsModal.tsx
src/components/pipeline/CreatePipelineModal.tsx
src/components/pipeline/StageEditor.tsx
src/components/pipeline/StageList.tsx
```

## Files to Modify

```
src/types/database.ts                              # Add Pipeline type, update PipelineStage, Lead
src/lib/supabase/queries.ts                        # Update getPipelineStages, getLeadsForPipeline
src/app/(main)/(dashboard)/pipeline/page.tsx       # Add pipeline selector, pass selected pipeline
src/components/pipeline/PipelineBoard.tsx          # Accept pipeline prop, filter by pipeline
src/components/dashboard/add-lead-sheet.tsx        # Use current pipeline for new leads
```

---

## Industry Default Pipelines (Future Enhancement)

| Industry | Default Pipelines |
|----------|-------------------|
| **Education Consultancy** | Student Intake, Scholarship Track |
| **IT Agency** | Sales Pipeline, Support/Retainer |
| **Real Estate** | Property Sales, Rentals |
| **Recruitment** | Candidate Pipeline, Client Acquisition |
| **Healthcare** | Patient Intake, Insurance Claims |
| **Construction** | Project Bidding, Active Projects |

---

## CRM Pattern References

### HubSpot Model (what we're following)
- Independent pipelines with local stages
- Each pipeline has completely independent stage names
- One default pipeline per account
- Required: at least one "Closed Won" and one "Closed Lost" stage
- Drag-and-drop stage reorder
- Stage probability % for forecasting (future)

### Salesforce Model (for reference)
- Global stage picklist, Sales Processes select subsets
- More complex but enables cross-pipeline reporting
- Not recommended for our use case

---

## Questions Resolved

| Question | Decision |
|----------|----------|
| Pipeline scope per form? | Forms route to default pipeline (future: form-specific routing) |
| Forecasting/Probability? | Not in v1, can add later |
| Required fields per stage? | Not in v1, can add later |
| Pipeline permissions? | All pipelines visible to all tenant members |
| Cross-pipeline lead movement? | Not in v1 (leads stay in one pipeline) |
| Stage automation triggers? | Existing webhook system will fire on stage changes |

---

## Success Criteria

- [ ] Users can create multiple pipelines per tenant
- [ ] Each pipeline has independent, customizable stages
- [ ] Pipeline selector works smoothly with instant switching
- [ ] Stage management (add, edit, delete, reorder) works correctly
- [ ] Existing data migrated without issues
- [ ] No breaking changes to existing API consumers
- [ ] Realtime updates work across pipelines
