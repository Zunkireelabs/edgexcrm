# Domain — IT Agency (Zunkiree Labs)

A dual-audience map of the **it-agency** industry, modeled on the **Zunkiree Labs** tenant: an estimate-to-delivery spine for a software agency. Two lenses:

- **Business Logic** — plain language for sales, PMs, delivery leads, finance, HR, and clients.
- **Engineering Logic** — system design, DB schema, and component/logic relations for devs.

Gated by `getFeatureAccess()` (`src/industries/_loader.ts`). Feature list: `src/industries/it-agency/manifest.ts`. Note: **Insights is education-only** (it-agency gets a 404); HR/People is a universal layer dogfooded on this tenant.

---

## Business Logic

### Feature map (plain language)

| Feature | What it does | Who uses it |
|---------|--------------|-------------|
| **Leads** | Universal inbound prospects before they convert | Sales |
| **CRM Contacts** | People at client companies (leads convert into contacts) | Sales, PM |
| **Accounts** | Client companies — a 360° workspace (projects, team, billable, health) | Sales, delivery |
| **Deals** | Sales opportunities on a multi-pipeline kanban; won/lost from stage | Sales |
| **Services** | Reusable priced service/package catalog feeding proposals | Sales, finance |
| **Proposals** | Priced SOW anchored to a deal; accept syncs deal amount; public share link | Sales, founder |
| **Convert + Qualify** | Accepted proposal seeds the project baseline; human commits scope | Delivery lead, PM |
| **Projects (cockpit)** | Delivery cockpit: milestones, issues, change-requests, RAG health | PM, delivery lead |
| **Tasks + Time + Approvals** | Assignable work, logged hours, approval with rate snapshot | Team, PM, finance |
| **Resourcing / Utilization** | Allocate people to projects; billable hours ÷ capacity | Delivery lead, COO |
| **Status Reports** | Structured client report (accomplishments/risks/asks) + public share | PM → client |
| **People / Leave / Attendance** | HR layer: directory, skills, leave balances, clock in/out | HR, everyone |

### Agency journey (UX flow)

```mermaid
flowchart LR
    lead["Inbound lead"] --> conv["Convert →<br/>Contact + Account"]
    conv --> deal["Deal (pipeline)"]
    deal --> prop["Proposal (services catalog)"]
    prop --> share["Share public link"]
    share --> accept{"Accepts?"}
    accept -- no --> revise["Revise"]
    revise --> share
    accept -- yes --> proj["Convert → Project<br/>(baseline seeded)"]
    proj --> qualify["Qualify:<br/>commit scope + estimate"]
    qualify --> deliver["Cockpit:<br/>milestones · tasks · time"]
    deliver --> report["Status reports<br/>(public share)"]
    report --> done["Delivered ✅"]
```

### Sales-to-delivery workflow

```mermaid
flowchart TB
    subgraph sales["1 · Sales"]
        s1["Lead → convert to Contact/Account"] --> s2["Deal through pipeline stages"]
    end
    subgraph quote["2 · Quote"]
        q1["Proposal from services catalog"] --> q2["Public link"] --> q3["Accept → syncs deal amount"]
    end
    subgraph handoff["3 · Handoff (agent drafts, human commits)"]
        h1["Convert deal → project<br/>seeds hours, budget, brief"] --> h2["Qualify: commit definition-of-done + baseline"]
    end
    subgraph deliver["4 · Deliver"]
        d1["Milestones + tasks + time"] --> d2["Issues + change-requests amend budget"]
        d2 --> d3["Reconciliation: estimate vs actual"] --> d4["RAG health → status report"]
    end
    sales --> quote --> handoff --> deliver
```

### 🤖 AI & automation opportunities

Important: **no real LLM is wired yet** — the AI config (`it-agency/ai/agent.ts`) is an empty stub, Orca and AI-chat are mocks, and the project "pulse" card (`cockpit/ai-summary-card.tsx`) renders hardcoded sample text. But the workflow deliberately captures **clean structured signal** — an append-only decision ledger (`project_events`) — so AI can read it later. Highest-value insertions:

- **Proposal drafting** — generate line items + scope from the deal context and services catalog.
- **Baseline / qualify assist** — the accepted-proposal seed already computes hours/budget in `convert-to-project`; AI drafts, human commits.
- **Project health / risk** — reads `project_events` + reconciliation; `computeProjectHealth` is deterministic today.
- **Status-report generation** — draft the 5 sections from events since the last report (the sample UI already renders them).
- **Timesheet nudges** — flag gaps vs allocations (reminders cron exists).
- **Resource allocation** — match `skills` + capacity to fill the bench.

---

## Engineering Logic

### System design

```mermaid
flowchart TB
    subgraph sales["Sales — lib/deals"]
        deals["Deals api/v1/deals"]
        props["Proposals api/v1/proposals"]
        svc["Services catalog"]
    end
    subgraph handoff["Handoff"]
        conv["convert-to-project<br/>seeds baseline"]
        qual["qualify (commit scope)"]
        evt["lib/projects/events.ts (ledger)"]
    end
    subgraph delivery["Delivery — lib/projects"]
        proj["Projects cockpit"]
        tasks["Tasks + Time entries"]
        health["health.ts (RAG)"]
        reports["Status reports"]
    end
    hr["HR — lib/hr"]
    db[("Postgres RLS")]
    svc --> props
    deals --> props --> conv --> qual --> proj
    conv --> evt
    proj --> tasks
    proj --> health
    proj --> reports
    props --> db
    proj --> db
    hr --> db
```

### DB schema (it-agency slice)

```mermaid
erDiagram
    ACCOUNT ||--o{ CONTACT : "has"
    ACCOUNT ||--o{ DEAL : "has"
    SERVICE ||--o{ PROPOSAL_LINE_ITEM : "priced as"
    DEAL ||--o{ PROPOSAL : "receives"
    PROPOSAL ||--o{ PROPOSAL_LINE_ITEM : "itemizes"
    DEAL ||--o| PROJECT : "converts to"
    PROPOSAL ||--o| PROJECT : "seeds"
    PROJECT ||--o{ MILESTONE : "has"
    PROJECT ||--o{ ISSUE : "has"
    PROJECT ||--o{ CHANGE_REQUEST : "amends budget"
    PROJECT ||--o{ STATUS_REPORT : "has"
    PROJECT ||--o{ PROJECT_EVENT : "ledger (append-only)"
    PROJECT ||--o{ TASK : "has"
    TASK ||--o{ TIME_ENTRY : "logs"
    DEAL { string status "open|won|lost" }
    PROPOSAL { string status "draft|sent|accepted" }
    PROJECT {
        uuid deal_id FK
        int baseline_estimate_minutes
        int current_estimate_minutes
        timestamp qualified_at
    }
    TIME_ENTRY { string approval_status }
```

## Anchors
- Manifest & gating: `src/industries/it-agency/manifest.ts`, `src/industries/_loader.ts`
- Handoff & qualify: `api/v1/deals/[id]/convert-to-project/route.ts`, `api/v1/projects/[id]/qualify/route.ts`
- Delivery: `src/industries/it-agency/features/project-board/`, `src/lib/projects/{health,events}.ts`, mig `128_delivery_workflow.sql`
- Sales: `src/lib/deals/{queries,stages}.ts`, `features/{deals,proposals,services}/`
- HR: `src/components/dashboard/hr/*`, `src/lib/hr/*`, migs `112`–`122`
- AI seams (scaffolding): `it-agency/ai/agent.ts`, `features/project-board/lib/ai-preview.ts`, `cockpit/ai-summary-card.tsx`
- Business docs: `docs/FEATURE-CATALOG.md`, `docs/IT-AGENCY-DELIVERY-*.md`, `docs/HRMS-PHASE-*.md`
