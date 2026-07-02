# Industry Configurations Reference

This document describes all available industry types in the Lead Gen CRM system. Each industry has customized pipeline stages and entity types tailored to its specific workflow.

---

## Overview

| Industry | ID | Entity Type | Stages | Terminal States |
|----------|-----|-------------|--------|-----------------|
| Construction | `construction` | Project Types | 7 | Completed, Cancelled |
| Education Consultancy | `education_consultancy` | Partner Colleges | 7 | Enrolled, Rejected |
| General | `general` | Categories | 5 | Converted, Lost |
| Healthcare | `healthcare` | Specializations | 6 | Active, Discharged |
| IT Agency | `it_agency` | Services | 6 | Won, Lost |
| Real Estate | `real_estate` | Property Types | 6 | Closed, Lost |
| Recruitment | `recruitment` | Job Categories | 6 | Hired, Rejected |

---

## Construction

**ID:** `construction`
**Icon:** `hard-hat`
**Description:** Building contractors, architects, and construction services

### Entity Type
- **Label:** Project Types
- **Singular:** Project Type
- **Examples:** Residential Building, Commercial Construction, Renovation, Interior Design

### Pipeline Stages

| Position | Stage Name | Slug | Color | Default | Terminal |
|----------|------------|------|-------|---------|----------|
| 0 | New | `new` | #3b82f6 (Blue) | Yes | No |
| 1 | Site Visit | `site-visit` | #f97316 (Orange) | No | No |
| 2 | Quote Sent | `quote-sent` | #a855f7 (Purple) | No | No |
| 3 | Contract Signed | `contract-signed` | #14b8a6 (Teal) | No | No |
| 4 | In Progress | `in-progress` | #eab308 (Yellow) | No | No |
| 5 | Completed | `completed` | #22c55e (Green) | No | Yes |
| 6 | Cancelled | `cancelled` | #ef4444 (Red) | No | Yes |

### Workflow
1. **New** - Lead inquiry received
2. **Site Visit** - Scheduled/completed site assessment
3. **Quote Sent** - Cost estimate provided to client
4. **Contract Signed** - Agreement finalized
5. **In Progress** - Construction work underway
6. **Completed** - Project finished successfully
7. **Cancelled** - Project cancelled at any stage

---

## Education Consultancy

**ID:** `education_consultancy`
**Icon:** `graduation-cap`
**Description:** Universities, colleges, study abroad agencies, and educational institutions

### Entity Type
- **Label:** Partner Colleges
- **Singular:** College
- **Examples:** Harvard University, MIT, Stanford, Oxford, University of Melbourne

### Pipeline Stages

| Position | Stage Name | Slug | Color | Default | Terminal |
|----------|------------|------|-------|---------|----------|
| 0 | New | `new` | #3b82f6 (Blue) | Yes | No |
| 1 | Document Collection | `document-collection` | #f97316 (Orange) | No | No |
| 2 | Application Submitted | `application-submitted` | #a855f7 (Purple) | No | No |
| 3 | Offer Received | `offer-received` | #14b8a6 (Teal) | No | No |
| 4 | Visa Applied | `visa-applied` | #eab308 (Yellow) | No | No |
| 5 | Enrolled | `enrolled` | #22c55e (Green) | No | Yes |
| 6 | Rejected | `rejected` | #ef4444 (Red) | No | Yes |

### Workflow
1. **New** - Student inquiry received
2. **Document Collection** - Gathering transcripts, test scores, recommendations
3. **Application Submitted** - Application sent to university
4. **Offer Received** - Admission offer from university
5. **Visa Applied** - Student visa application submitted
6. **Enrolled** - Student successfully enrolled
7. **Rejected** - Application rejected or student withdrew

---

## General

**ID:** `general`
**Icon:** `folder`
**Description:** General-purpose CRM for any business type

### Entity Type
- **Label:** Categories
- **Singular:** Category
- **Examples:** Premium Service, Basic Package, Enterprise Solution

### Pipeline Stages

| Position | Stage Name | Slug | Color | Default | Terminal |
|----------|------------|------|-------|---------|----------|
| 0 | New | `new` | #3b82f6 (Blue) | Yes | No |
| 1 | Contacted | `contacted` | #f97316 (Orange) | No | No |
| 2 | Qualified | `qualified` | #a855f7 (Purple) | No | No |
| 3 | Converted | `converted` | #22c55e (Green) | No | Yes |
| 4 | Lost | `lost` | #ef4444 (Red) | No | Yes |

### Workflow
1. **New** - Lead captured
2. **Contacted** - Initial contact made
3. **Qualified** - Lead qualified as potential customer
4. **Converted** - Successfully converted to customer
5. **Lost** - Lead lost or disqualified

---

## Healthcare

**ID:** `healthcare`
**Icon:** `heart-pulse`
**Description:** Hospitals, clinics, and medical service providers

### Entity Type
- **Label:** Specializations
- **Singular:** Specialization
- **Examples:** Cardiology, Orthopedics, Dermatology, Pediatrics, General Medicine

### Pipeline Stages

| Position | Stage Name | Slug | Color | Default | Terminal |
|----------|------------|------|-------|---------|----------|
| 0 | New | `new` | #3b82f6 (Blue) | Yes | No |
| 1 | Consultation Scheduled | `consultation-scheduled` | #f97316 (Orange) | No | No |
| 2 | Assessment | `assessment` | #a855f7 (Purple) | No | No |
| 3 | Treatment Plan | `treatment-plan` | #eab308 (Yellow) | No | No |
| 4 | Active | `active` | #22c55e (Green) | No | Yes |
| 5 | Discharged | `discharged` | #6b7280 (Gray) | No | Yes |

### Workflow
1. **New** - Patient inquiry received
2. **Consultation Scheduled** - Appointment booked
3. **Assessment** - Initial examination completed
4. **Treatment Plan** - Care plan established
5. **Active** - Patient under active care
6. **Discharged** - Treatment completed, patient discharged

---

## IT Agency

**ID:** `it_agency`
**Icon:** `code`
**Description:** Software development, digital marketing, and technology services

### Entity Type
- **Label:** Services
- **Singular:** Service
- **Examples:** Web Development, Mobile App Development, UI/UX Design, Cloud & DevOps, AI/ML Solutions, Digital Marketing

### Pipeline Stages

| Position | Stage Name | Slug | Color | Default | Terminal |
|----------|------------|------|-------|---------|----------|
| 0 | New | `new` | #3b82f6 (Blue) | Yes | No |
| 1 | Discovery Call | `discovery-call` | #f97316 (Orange) | No | No |
| 2 | Proposal Sent | `proposal-sent` | #a855f7 (Purple) | No | No |
| 3 | Negotiation | `negotiation` | #eab308 (Yellow) | No | No |
| 4 | Won | `won` | #22c55e (Green) | No | Yes |
| 5 | Lost | `lost` | #ef4444 (Red) | No | Yes |

### Workflow
1. **New** - Lead inquiry received
2. **Discovery Call** - Initial call to understand requirements
3. **Proposal Sent** - Project proposal and quote delivered
4. **Negotiation** - Terms and pricing discussion
5. **Won** - Deal closed successfully
6. **Lost** - Deal lost to competitor or cancelled

---

## Real Estate

**ID:** `real_estate`
**Icon:** `building`
**Description:** Property sales, rentals, and real estate agencies

### Entity Type
- **Label:** Property Types
- **Singular:** Property Type
- **Examples:** Apartment, House, Commercial Space, Land, Villa, Condo

### Pipeline Stages

| Position | Stage Name | Slug | Color | Default | Terminal |
|----------|------------|------|-------|---------|----------|
| 0 | New | `new` | #3b82f6 (Blue) | Yes | No |
| 1 | Property Shown | `property-shown` | #f97316 (Orange) | No | No |
| 2 | Offer Made | `offer-made` | #a855f7 (Purple) | No | No |
| 3 | Under Contract | `under-contract` | #eab308 (Yellow) | No | No |
| 4 | Closed | `closed` | #22c55e (Green) | No | Yes |
| 5 | Lost | `lost` | #ef4444 (Red) | No | Yes |

### Workflow
1. **New** - Buyer/renter inquiry received
2. **Property Shown** - Property viewing completed
3. **Offer Made** - Buyer submitted offer
4. **Under Contract** - Purchase agreement signed
5. **Closed** - Transaction completed
6. **Lost** - Deal fell through

---

## Recruitment

**ID:** `recruitment`
**Icon:** `briefcase`
**Description:** Staffing agencies, HR services, and talent acquisition

### Entity Type
- **Label:** Job Categories
- **Singular:** Job Category
- **Examples:** Software Engineering, Marketing, Sales, Finance, Operations, HR

### Pipeline Stages

| Position | Stage Name | Slug | Color | Default | Terminal |
|----------|------------|------|-------|---------|----------|
| 0 | New | `new` | #3b82f6 (Blue) | Yes | No |
| 1 | Screening | `screening` | #f97316 (Orange) | No | No |
| 2 | Interview | `interview` | #a855f7 (Purple) | No | No |
| 3 | Offer | `offer` | #eab308 (Yellow) | No | No |
| 4 | Hired | `hired` | #22c55e (Green) | No | Yes |
| 5 | Rejected | `rejected` | #ef4444 (Red) | No | Yes |

### Workflow
1. **New** - Candidate application received
2. **Screening** - Resume review and initial screening
3. **Interview** - Interview process (phone/video/in-person)
4. **Offer** - Job offer extended
5. **Hired** - Candidate accepted and onboarded
6. **Rejected** - Candidate rejected or withdrew

---

## Database Schema

### Industries Table
```sql
CREATE TABLE industries (
  id VARCHAR(50) PRIMARY KEY,
  name VARCHAR(100) NOT NULL,
  description TEXT,
  entity_type_label VARCHAR(100) NOT NULL,
  entity_type_singular VARCHAR(100) NOT NULL,
  icon VARCHAR(50),
  default_pipeline_stages JSONB DEFAULT '[]',
  created_at TIMESTAMPTZ DEFAULT NOW()
);
```

### Tenant Entities Table
```sql
CREATE TABLE tenant_entities (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name VARCHAR(255) NOT NULL,
  slug VARCHAR(100) NOT NULL,
  description TEXT,
  metadata JSONB DEFAULT '{}',
  is_active BOOLEAN DEFAULT true,
  position INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  UNIQUE(tenant_id, slug)
);
```

### Tenant Industry Assignment
```sql
-- Add industry_id to tenants
ALTER TABLE tenants ADD COLUMN industry_id VARCHAR(50) REFERENCES industries(id);

-- Add entity_id to leads (optional FK to selected entity)
ALTER TABLE leads ADD COLUMN entity_id UUID REFERENCES tenant_entities(id) ON DELETE SET NULL;
```

---

## API Endpoints

### Industries (Public)
- `GET /api/v1/industries` - List all available industries

### Tenant Entities (Authenticated)
- `GET /api/v1/entities` - List tenant's entities
- `POST /api/v1/entities` - Create new entity
- `GET /api/v1/entities/[id]` - Get single entity
- `PATCH /api/v1/entities/[id]` - Update entity
- `DELETE /api/v1/entities/[id]` - Delete entity

### Public Entities (For Forms)
- `GET /api/v1/entities/public?tenant_id=<uuid>` - List active entities for form dropdowns

---

## Form Integration

To add entity selection to a form, use the `entity_select` field type:

```json
{
  "name": "preferred_college",
  "label": "Preferred College",
  "type": "entity_select",
  "required": true,
  "placeholder": "Select a college...",
  "width": "full"
}
```

The field will automatically:
1. Fetch active entities for the tenant
2. Display them in a dropdown
3. Store the selected `entity_id` on the lead record

---

## Current Tenant Assignments

| Tenant | Slug | Industry |
|--------|------|----------|
| Admizz Education | `admizz` | Education Consultancy |
| Zunkiree Labs | `zunkireelabs-crm` | IT Agency |

---

## Future Enhancements

1. **Platform Admin Dashboard** - UI for assigning industries to tenants
2. **Custom Pipeline Stages** - Allow tenants to customize stages beyond defaults
3. **Industry-Specific Analytics** - Tailored reporting per industry
4. **Entity Metadata** - Industry-specific fields in entity metadata (e.g., college rankings, service pricing)
