# Industry-Specific Tenant Customization

## Summary

Add industry classification and industry-specific entity management to the multi-tenant CRM. Each tenant can be assigned an industry (Education, IT Services, Construction, etc.) and manage industry-specific entities (Colleges, Services, Project Types) that appear in lead forms and details.

**Examples:**
- **Admizz Education** (Education Consultancy): Manages "Partner Colleges" list
- **Zunkiree Labs** (IT Agency): Manages "Services" list
- **Khusbu Nirman Sewa** (Construction): Manages "Project Types" list

---

## Branch

Create new branch: `feature/industry-customization`

---

## Phase 1: Database Schema

### Migration: `012_industry_customization.sql`

**1. Create `industries` reference table (system-wide)**
```sql
CREATE TABLE industries (
  id VARCHAR(50) PRIMARY KEY,
  name VARCHAR(100) NOT NULL,
  description TEXT,
  entity_type_label VARCHAR(100) NOT NULL,   -- "Partner Colleges"
  entity_type_singular VARCHAR(100) NOT NULL, -- "College"
  icon VARCHAR(50),
  default_pipeline_stages JSONB DEFAULT '[]',
  created_at TIMESTAMPTZ DEFAULT NOW()
);
```

**Seed industries:**
- `education_consultancy` - Partner Colleges
- `it_agency` - Services
- `construction` - Project Types
- `real_estate` - Property Types
- `healthcare` - Specializations
- `recruitment` - Job Categories
- `general` - Categories

**Industry-specific default pipeline stages** (stored in `industries.default_pipeline_stages` JSONB):

| Industry | Default Stages |
|----------|----------------|
| Education | New → Document Collection → Application Submitted → Offer Received → Visa Applied → Enrolled / Rejected |
| IT Agency | New → Discovery Call → Proposal Sent → Negotiation → Won / Lost |
| Construction | New → Site Visit → Quote Sent → Contract Signed → In Progress → Completed / Cancelled |
| Real Estate | New → Property Shown → Offer Made → Under Contract → Closed / Lost |
| Healthcare | New → Consultation Scheduled → Assessment → Treatment Plan → Active / Discharged |
| Recruitment | New → Screening → Interview → Offer → Hired / Rejected |
| General | New → Contacted → Qualified → Converted / Lost |

**2. Add `industry_id` to `tenants` table**
```sql
ALTER TABLE tenants ADD COLUMN industry_id VARCHAR(50) REFERENCES industries(id);
```

**3. Create `tenant_entities` table**
```sql
CREATE TABLE tenant_entities (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name VARCHAR(255) NOT NULL,
  slug VARCHAR(100) NOT NULL,
  description TEXT,
  metadata JSONB DEFAULT '{}',  -- Industry-specific fields
  is_active BOOLEAN DEFAULT true,
  position INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(tenant_id, slug)
);
```

**4. RLS Policies** (follow `pipeline_stages` pattern):
- Tenant members can view their entities
- Public/anon can read active entities (for form dropdowns)
- Admins can insert/update/delete

**5. Add `entity_id` to `leads` table** (optional FK to selected entity)

---

## Phase 2: TypeScript Types

**File:** `src/types/database.ts`

```typescript
// Add industry types
export type IndustryId =
  | "education_consultancy"
  | "it_agency"
  | "construction"
  | "real_estate"
  | "healthcare"
  | "recruitment"
  | "general";

export interface Industry {
  id: IndustryId;
  name: string;
  description: string | null;
  entity_type_label: string;
  entity_type_singular: string;
  icon: string | null;
  default_pipeline_stages: PipelineStageTemplate[];
  created_at: string;
}

export interface PipelineStageTemplate {
  name: string;
  slug: string;
  position: number;
  color: string;
  is_default: boolean;
  is_terminal: boolean;
}

export interface TenantEntity {
  id: string;
  tenant_id: string;
  name: string;
  slug: string;
  description: string | null;
  metadata: Record<string, unknown>;
  is_active: boolean;
  position: number;
  created_at: string;
  updated_at: string;
}

// Update Tenant interface
export interface Tenant {
  // ... existing fields
  industry_id: IndustryId | null;  // ADD
}

// Update Lead interface
export interface Lead {
  // ... existing fields
  entity_id: string | null;  // ADD
}
```

---

## Phase 3: API Routes

### 3.1 Industries API (read-only)
**File:** `src/app/api/v1/industries/route.ts`
- `GET /api/v1/industries` - List all industries (public)

### 3.2 Tenant Entities CRUD
**File:** `src/app/api/v1/entities/route.ts`
- `GET /api/v1/entities` - List tenant's entities
- `POST /api/v1/entities` - Create entity

**File:** `src/app/api/v1/entities/[id]/route.ts`
- `GET /api/v1/entities/[id]` - Get single entity
- `PATCH /api/v1/entities/[id]` - Update entity
- `DELETE /api/v1/entities/[id]` - Delete entity

### 3.3 Update Tenant Settings API
- Allow updating `industry_id` on tenant (Platform Admin only)

---

## Phase 4: Tenant Settings UI

### 4.1 Industry Display Card (Read-Only for Tenant)
**File:** `src/components/dashboard/settings/industry-info-card.tsx`

- Shows current industry type (read-only badge/label)
- Shows industry description
- Shows entity type label (e.g., "This tenant manages: Partner Colleges")
- **NOT editable by tenant** - industry is set by Platform Admin

### 4.2 Industry Entities Manager
**File:** `src/components/dashboard/settings/industry-entities-manager.tsx`

- CRUD table for entities (follow `api-keys-manager.tsx` pattern)
- Dynamic header based on industry: "Manage Colleges" / "Manage Services"
- Add/Edit dialog with:
  - Name (required)
  - Description (optional)
  - Active/Inactive toggle
  - Drag-to-reorder positions

### 4.3 Update Settings Form
**File:** `src/components/dashboard/settings-form.tsx`

- Add IndustryInfoCard after Organization card (read-only display)
- Add IndustryEntitiesManager (show only when tenant has industry_id set)

---

## Phase 5: Form Integration

### 5.1 New Field Type: `entity_select`
**File:** `src/types/database.ts` (FormField type)

```typescript
type: "text" | "email" | ... | "entity_select";  // ADD
```

### 5.2 Entity Picker Component
**File:** `src/components/form/entity-select-field.tsx`

- Fetches active entities for tenant
- Renders as Select dropdown
- Label from industry config (e.g., "Preferred College")

### 5.3 Update Public Form
**File:** `src/components/form/public-form.tsx`

- Handle `entity_select` field type
- Fetch entities from `/api/v1/entities?active=true`
- Store selected entity_id in lead.custom_fields or lead.entity_id

---

## Phase 6: Lead Detail Display

### 6.1 Update Key Info Section
**File:** `src/components/dashboard/lead/key-info-section.tsx`

- If lead has entity_id, show entity name prominently
- Display entity metadata if available
- Group under industry-specific section header

---

## Phase 7: Platform Admin Dashboard (Future)

A separate admin interface for platform-level management.

### 7.1 Platform Admin Routes
**File:** `src/app/(platform-admin)/layout.tsx` - Protected layout for super admins

**Pages:**
- `/platform-admin/tenants` - List all tenants with industry, status, stats
- `/platform-admin/tenants/[id]` - Tenant detail with edit capabilities
- `/platform-admin/tenants/new` - Create new tenant wizard
- `/platform-admin/industries` - Manage industry definitions

### 7.2 Tenant Management UI
**File:** `src/components/platform-admin/tenant-form.tsx`

- Create/Edit tenant form
- **Industry selector dropdown** (the key control for setting tenant industry)
- Option to seed default pipeline stages from industry
- Tenant branding configuration
- Owner email assignment

### 7.3 Tenant Onboarding Wizard
**File:** `src/components/platform-admin/tenant-wizard.tsx`

Steps:
1. Basic Info (name, slug)
2. **Industry Selection** → auto-previews pipeline stages
3. Owner Assignment (email invite)
4. Branding (logo, colors)
5. Review & Create

### 7.4 Platform Admin Auth
- New role: `platform_admin` (or check against hardcoded super admin emails)
- Separate auth check in middleware
- Access to all tenants (bypass tenant_id scoping)

### 7.5 Database Changes for Platform Admin
```sql
-- Add super_admin flag to users or separate platform_admins table
ALTER TABLE tenant_users ADD COLUMN is_platform_admin BOOLEAN DEFAULT false;
-- Or create dedicated table
CREATE TABLE platform_admins (
  user_id UUID PRIMARY KEY REFERENCES auth.users(id),
  created_at TIMESTAMPTZ DEFAULT NOW()
);
```

---

## Files to Modify

| File | Changes |
|------|---------|
| `supabase/migrations/012_industry_customization.sql` | New migration |
| `src/types/database.ts` | Add Industry, TenantEntity types; update Tenant, Lead, FormField |
| `src/app/api/v1/industries/route.ts` | New - list industries |
| `src/app/api/v1/entities/route.ts` | New - entities CRUD |
| `src/app/api/v1/entities/[id]/route.ts` | New - single entity CRUD |
| `src/components/dashboard/settings-form.tsx` | Import new cards |
| `src/components/dashboard/settings/industry-info-card.tsx` | New component (read-only display) |
| `src/components/dashboard/settings/industry-entities-manager.tsx` | New component |
| `src/components/form/entity-select-field.tsx` | New component |
| `src/components/form/public-form.tsx` | Handle entity_select field type |
| `src/components/dashboard/lead/key-info-section.tsx` | Display entity info |

**Phase 7 (Future):**
| `src/app/(platform-admin)/*` | New admin section |
| `src/components/platform-admin/*` | Admin components |

---

## Verification

1. **Database**: Run migration, verify tables created with `\dt` in psql
2. **API**: Test CRUD endpoints with curl/Postman
3. **Settings UI**:
   - View industry info card (read-only)
   - Add/edit/delete entities
   - Verify entities persist on refresh
4. **Public Form**:
   - Add `entity_select` field to a form config
   - Submit form, verify entity stored on lead
5. **Lead Detail**: View lead, confirm entity displayed correctly

---

## Implementation Tasks

### This Phase (Phases 1-6)

1. Create git branch `feature/industry-customization`
2. Write and run database migration (includes industry default pipeline stages)
3. Update TypeScript types
4. Implement industries API route (GET only)
5. Implement entities CRUD API routes
6. Build IndustryInfoCard component (read-only display)
7. Build IndustryEntitiesManager component (CRUD for entities)
8. Update settings-form.tsx to include new components
9. Build entity-select-field component
10. Update public-form.tsx for entity_select
11. Update key-info-section.tsx for entity display
12. **Set industry for existing tenants via SQL** (Admizz = education_consultancy)
13. Test end-to-end flow
14. Deploy to staging

### Future Phase (Phase 7)

15. Design Platform Admin auth model
16. Create platform-admin route group and layout
17. Build tenant list page
18. Build tenant create/edit form with industry selector
19. Build tenant onboarding wizard
20. Add platform admin seeding/management

---

## Onboarding Workflow

### Current Phase (Manual via SQL)
When setting up a new tenant:
1. Create tenant record via SQL with `industry_id` set
2. Run SQL to seed industry's default pipeline stages
3. Tenant admin can then add their entities (colleges, services, etc.)
4. Tenant admin configures forms with entity_select fields

### After Phase 7 (Platform Admin Dashboard)
When setting up a new tenant:
1. Platform Admin opens `/platform-admin/tenants/new`
2. Fills in tenant details and **selects industry from dropdown**
3. System auto-seeds default pipeline stages
4. System sends invite to tenant owner
5. Tenant owner accepts, logs in, adds entities and configures forms
