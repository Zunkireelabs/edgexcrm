# Enhanced Dashboard Implementation Plan

**Reference**: Agentcis CRM Dashboard (`/temp_ss/Screenshot 2026-03-23 at 21.57.42.png`)

## Executive Summary

Transform the current simple stats + table dashboard into a comprehensive CRM command center with:
- Enhanced KPI cards with trend indicators
- Visual pipeline analytics (charts)
- Productivity widgets (tasks, reminders)
- Team performance visibility

---

## Current State

**Dashboard Page**: `src/app/(main)/(dashboard)/dashboard/page.tsx`
- 5 stats cards: Total, New, Contacted, Enrolled, Rejected
- Leads table with search/filter/CSV export

**Available Data**:
- `leads` table with `status`, `stage_id`, `assigned_to`, `created_at`, `form_config_id`
- `pipeline_stages` table for custom stages
- `tenant_users` for team members
- `form_configs` for lead sources

**Missing** (needs new tables):
- Tasks/reminders system
- Appointments/calendar

---

## Phase 1: Enhanced Stats Cards (Quick Win)

**Goal**: Add trend indicators and clickable filters

### Changes to `stats-cards.tsx`:

```
Before:
┌──────────┬──────────┬──────────┬──────────┬──────────┐
│ Total    │ New      │ Contacted│ Enrolled │ Rejected │
│ 45       │ 12       │ 18       │ 10       │ 5        │
└──────────┴──────────┴──────────┴──────────┴──────────┘

After:
┌──────────┬──────────┬──────────┬──────────┬──────────┐
│ TOTAL    │ NEW      │ CONTACTED│ ENROLLED │ REJECTED │
│ 45       │ 12       │ 18       │ 10       │ 5        │
│ +8 this  │ +12 this │ +6 this  │ +3 this  │ +1 this  │
│ week     │ week     │ week     │ week     │ week     │
└──────────┴──────────┴──────────┴──────────┴──────────┘
        ↑ Clicking filters the leads table below
```

### Implementation:
1. Pass `leads` with `created_at` to calculate "this week/month" counts
2. Add trend calculation (compare to previous period)
3. Add `onClick` handler to filter leads table
4. Update styling to match Agentcis (uppercase labels, smaller text)

### Files:
- `src/components/dashboard/stats-cards.tsx` - enhance with trends
- `src/app/(main)/(dashboard)/dashboard/page.tsx` - add filter state

---

## Phase 2: Pipeline Charts

**Goal**: Visual pipeline distribution with donut/bar charts

### New Components:

```
src/components/dashboard/charts/
├── leads-by-stage-chart.tsx    # Donut chart - pipeline stage distribution
├── leads-by-source-chart.tsx   # Bar chart - by form/source
└── leads-by-counselor-chart.tsx # Horizontal bar - team workload
```

### Dependencies to Add:
```bash
npm install recharts
npx shadcn@latest add chart
```

### Layout:
```
┌─────────────────────────────────┬─────────────────────────────────┐
│ LEADS BY STAGE                  │ LEADS BY SOURCE                 │
│                                 │                                 │
│     [Donut Chart]              │     [Bar Chart]                 │
│  ● New: 12                     │ RKU Form ████████ 25            │
│  ● Contacted: 18               │ Admizz   ████ 12                │
│  ● Enrolled: 10                │ Website  ██ 8                   │
│  ● Rejected: 5                 │                                 │
└─────────────────────────────────┴─────────────────────────────────┘
```

### Data Queries (add to `queries.ts`):
```typescript
// Leads grouped by stage
export async function getLeadsByStage(tenantId: string) {
  // GROUP BY stage_id, JOIN pipeline_stages for colors/names
}

// Leads grouped by form source
export async function getLeadsBySource(tenantId: string) {
  // GROUP BY form_config_id, JOIN form_configs for names
}

// Leads grouped by assigned counselor
export async function getLeadsByCounselor(tenantId: string) {
  // GROUP BY assigned_to, JOIN tenant_users for names
}
```

---

## Phase 3: Tasks System (New Feature)

**Goal**: "My Tasks Today" widget like Agentcis

### Database Migration:

```sql
-- 009_tasks_system.sql
CREATE TABLE tasks (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  lead_id UUID REFERENCES leads(id) ON DELETE CASCADE,
  assigned_to UUID NOT NULL REFERENCES auth.users(id),
  title TEXT NOT NULL,
  description TEXT,
  due_date DATE NOT NULL,
  due_time TIME,
  priority TEXT CHECK (priority IN ('low', 'medium', 'high')) DEFAULT 'medium',
  completed_at TIMESTAMPTZ,
  completed_by UUID REFERENCES auth.users(id),
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- RLS policies
ALTER TABLE tasks ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view tasks in their tenant"
  ON tasks FOR SELECT
  USING (tenant_id IN (SELECT get_user_tenant_ids()));

CREATE POLICY "Users can manage their assigned tasks"
  ON tasks FOR ALL
  USING (assigned_to = auth.uid());

CREATE POLICY "Admins can manage all tenant tasks"
  ON tasks FOR ALL
  USING (is_tenant_admin(tenant_id));
```

### New Components:

```
src/components/dashboard/widgets/
├── tasks-widget.tsx       # "My Tasks Today" with +Add button
├── task-dialog.tsx        # Create/edit task modal
└── task-item.tsx          # Individual task row with checkbox
```

### API Routes:
```
src/app/(main)/api/v1/tasks/
├── route.ts              # GET (list), POST (create)
└── [id]/route.ts         # GET, PATCH (complete), DELETE
```

---

## Phase 4: Team Performance View (Managers Only)

**Goal**: "Clients by Users" style workload visibility

### New Component:
`src/components/dashboard/charts/team-workload-chart.tsx`

```
┌─────────────────────────────────────────────────────────────────┐
│ LEADS BY COUNSELOR                                              │
│                                                                 │
│ john@example.com     ████████████████████ 24                   │
│ jane@example.com     ████████████ 15                           │
│ mike@example.com     ████████ 10                               │
│ Unassigned           ████ 6                                    │
└─────────────────────────────────────────────────────────────────┘
```

### Access Control:
- Only show to `owner` and `admin` roles
- Counselors see only their own stats

---

## Phase 5: Follow-up Reminders

**Goal**: "Application Reminders" widget

### Implementation Options:

**Option A: Leverage existing `lead_checklists`**
- Filter checklists with upcoming due items
- Less migration, uses existing infrastructure

**Option B: Add `reminder_date` to tasks table**
- Tasks can have optional reminder notifications
- More flexible

### Widget:
```
┌─────────────────────────────────────┐
│ FOLLOW-UP REMINDERS                 │
│                                     │
│ ⚠️ Call John Smith (2 days overdue) │
│ 📞 Follow up with Jane (due today)  │
│ 📋 Send docs to Mike (tomorrow)     │
│                                     │
│ No reminders at the moment.         │ (empty state)
└─────────────────────────────────────┘
```

---

## Implementation Order

| Phase | Feature | Effort | Dependencies | Priority |
|-------|---------|--------|--------------|----------|
| 1 | Enhanced stats cards with trends | 2-3 hrs | None | P1 |
| 2 | Pipeline charts (donut + bar) | 4-5 hrs | recharts, shadcn chart | P1 |
| 3 | Tasks system | 1 day | DB migration | P2 |
| 4 | Team workload chart | 2-3 hrs | Phase 2 charts | P2 |
| 5 | Follow-up reminders widget | 3-4 hrs | Phase 3 tasks OR checklists | P3 |

---

## Color Palette (Matching Agentcis)

```typescript
// src/lib/chart-colors.ts
export const statusColors = {
  new: { bg: "bg-blue-100", text: "text-blue-700", chart: "#3B82F6" },
  contacted: { bg: "bg-amber-100", text: "text-amber-700", chart: "#F59E0B" },
  enrolled: { bg: "bg-green-100", text: "text-green-700", chart: "#22C55E" },
  rejected: { bg: "bg-red-100", text: "text-red-700", chart: "#EF4444" },
};

export const chartColors = [
  "#3B82F6", // Blue
  "#22C55E", // Green
  "#F59E0B", // Amber
  "#8B5CF6", // Purple
  "#EC4899", // Pink
];
```

---

## Files to Create/Modify

### New Files:
- `src/components/dashboard/charts/leads-by-stage-chart.tsx`
- `src/components/dashboard/charts/leads-by-source-chart.tsx`
- `src/components/dashboard/charts/team-workload-chart.tsx`
- `src/components/dashboard/widgets/tasks-widget.tsx`
- `src/components/dashboard/widgets/reminders-widget.tsx`
- `src/lib/chart-colors.ts`
- `supabase/migrations/009_tasks_system.sql` (Phase 3)

### Modified Files:
- `src/components/dashboard/stats-cards.tsx` - add trends
- `src/app/(main)/(dashboard)/dashboard/page.tsx` - new layout with charts
- `src/lib/supabase/queries.ts` - add aggregation queries
- `src/types/database.ts` - add Task type
- `package.json` - add recharts

---

## Approval Checklist

Before implementation:
- [ ] Confirm Phase 1-2 for immediate implementation
- [ ] Confirm Phase 3 (tasks) scope and priority
- [ ] Confirm chart library choice (recharts via shadcn)
- [ ] Decide: Tasks widget vs just enhanced checklists

---

## Next Steps

1. User approves phases to implement
2. Install dependencies (`recharts`, `shadcn chart`)
3. Implement Phase 1 (stats cards enhancement)
4. Implement Phase 2 (charts)
5. Test and verify responsive design
6. Consider Phase 3+ based on feedback
