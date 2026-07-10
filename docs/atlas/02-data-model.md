# Data Model

Core entities and relationships, split into four readable views. Source of truth: `src/types/database.ts` (every interface) and `supabase/migrations/*.sql` (DDL / foreign keys). Note: the UI labels **LeadList** as "Stage".

## A. Tenancy spine

Every tenant table carries `tenant_id` and is isolated by Row-Level Security. `tenant_users` is the auth pivot — it joins a Supabase auth user to a tenant with a role, position, and branch.

```mermaid
erDiagram
    TENANT ||--o{ TENANT_USER : "has members"
    TENANT }o--|| INDUSTRY : "is one industry"
    TENANT ||--o{ BRANCH : "has"
    TENANT ||--o{ POSITION : "defines"
    TENANT ||--o{ ORG_LAYER : "defines"
    BRANCH ||--o{ TENANT_USER : "employs"
    POSITION ||--o{ TENANT_USER : "assigned to"
    ORG_LAYER ||--o{ POSITION : "groups"

    TENANT {
        uuid id PK
        string industry_id FK
        string plan
        jsonb config
        jsonb entitlement_overrides
    }
    INDUSTRY {
        string id PK
        jsonb default_pipeline_stages
    }
    TENANT_USER {
        uuid user_id FK "Supabase auth user"
        uuid tenant_id FK
        string role "owner|admin|viewer|counselor"
        uuid position_id FK
        uuid branch_id FK
    }
    BRANCH {
        uuid id PK
        uuid manager_user_id FK
        bool is_default
    }
    POSITION {
        uuid id PK
        jsonb permissions
    }
    ORG_LAYER { uuid id PK }
```

## B. Leads core (universal)

The `leads` table is the central object across every industry. A lead sits in a pipeline + stage, optionally in a UI "Stage" (LeadList), and can be shared across branches. Submissions and merges support dedup.

```mermaid
erDiagram
    TENANT ||--o{ LEAD : "owns"
    PIPELINE ||--o{ PIPELINE_STAGE : "has"
    PIPELINE ||--o{ LEAD : "routes"
    PIPELINE_STAGE ||--o{ LEAD : "holds"
    LEAD_LIST ||--o{ LEAD : "buckets (UI: Stage)"
    FORM_CONFIG ||--o{ LEAD : "captures"
    TENANT_USER ||--o{ LEAD : "assigned_to"
    LEAD ||--o{ LEAD_NOTE : "has"
    LEAD ||--o{ LEAD_CHECKLIST : "has"
    LEAD ||--o{ LEAD_ACTIVITY : "call/email/meeting"
    LEAD ||--o| LEAD_INSIGHTS : "AI score"
    LEAD ||--o{ LEAD_SUBMISSION : "form submits"
    LEAD ||--o{ LEAD_BRANCH : "shared with"
    BRANCH ||--o{ LEAD_BRANCH : "shares"
    LEAD ||--o| LEAD : "merged_into (dedup)"

    LEAD {
        uuid id PK
        uuid tenant_id FK
        uuid pipeline_id FK
        uuid stage_id FK
        uuid list_id FK
        uuid assigned_to FK
        uuid form_config_id FK
        string normalized_email
        uuid merged_into FK
        jsonb custom_fields
        int ai_score
        timestamp deleted_at
    }
    FORM_CONFIG {
        uuid id PK
        jsonb steps "dynamic form"
        jsonb attribution
    }
    LEAD_LIST {
        uuid id PK
        bool is_intake
        uuid pipeline_id FK
    }
    PIPELINE { uuid id PK }
    PIPELINE_STAGE { uuid id PK }
```

## C. IT-agency delivery chain

Sales-to-delivery: an Account holds Contacts and Deals; a won Deal's accepted Proposal converts into a Project, which tracks work via Tasks and TimeEntries.

```mermaid
erDiagram
    ACCOUNT ||--o{ CONTACT : "has"
    ACCOUNT ||--o{ DEAL : "has"
    DEAL }o--o{ CONTACT : "deal_contacts"
    DEAL ||--o{ PROPOSAL : "receives"
    PROPOSAL ||--o{ PROPOSAL_LINE_ITEM : "itemizes"
    SERVICE ||--o{ PROPOSAL_LINE_ITEM : "priced as"
    DEAL ||--o| PROJECT : "convert-to-project"
    PROPOSAL ||--o| PROJECT : "seeds baseline"
    ACCOUNT ||--o{ PROJECT : "for"
    PROJECT }o--o{ CONTACT : "project_contacts"
    PROJECT ||--o{ PROJECT_MILESTONE : "has"
    PROJECT ||--o{ PROJECT_ISSUE : "has"
    PROJECT ||--o{ PROJECT_CHANGE_REQUEST : "has"
    PROJECT ||--o{ PROJECT_STATUS_REPORT : "has"
    PROJECT ||--o{ PROJECT_EVENT : "event log"
    PROJECT ||--o{ TASK : "has"
    TASK ||--o{ TIME_ENTRY : "logs"

    DEAL {
        uuid id PK
        uuid account_id FK
        uuid primary_contact_id FK
        uuid pipeline_id FK
        string status "open|won|lost"
    }
    PROPOSAL {
        uuid id PK
        uuid deal_id FK
        uuid project_id FK
        string status "draft|accepted"
        string public_token
        numeric total
    }
    PROJECT {
        uuid id PK
        uuid account_id FK
        uuid deal_id FK
        int baseline_estimate_minutes
        numeric budget_amount
    }
    TASK { uuid id PK }
    TIME_ENTRY { string approval_status }
```

## D. Education-consultancy domain

Education adds student applications, classes, telecaller campaigns, and a country/course taxonomy on top of the leads core.

```mermaid
erDiagram
    LEAD ||--o{ APPLICATION : "applies via"
    APPLICATION_STAGE ||--o{ APPLICATION : "on board"
    LEAD }o--o{ CLASS : "class_enrollments"
    TENANT ||--o{ CAMPAIGN : "runs (leaderboard)"
    COUNTRY ||--o{ COURSE : "offers"
    PARTNER_COLLEGE ||--o{ COURSE : "teaches"
    AGENT ||--o{ LEAD : "sources"

    APPLICATION {
        uuid id PK
        uuid lead_id FK
        string university
        string program
        string intake
    }
    CLASS { uuid id PK }
    CAMPAIGN {
        uuid id PK
        string leaderboard_token
    }
    COUNTRY { uuid id PK }
    COURSE { uuid id PK }
```

## Anchors
- Entities & fields: `src/types/database.ts`
- DDL / FKs / constraints: `supabase/migrations/` (e.g. `001_initial_schema.sql`, `046` deals, `103` proposals, `023` projects, `088` application stages, `059` lead lists)
- Dedup/merge: `src/lib/leads/dedup.ts`, migrations `033`, `034`
