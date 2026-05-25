# Architecture: Industry Modules — Old vs New

> **Audience**: developers (human or Claude) joining the codebase, or anyone who needs to explain the architecture in a meeting. Companion to `CLAUDE.md § Industry Scoping Rules` — that section has the *rules*; this doc has the *reasoning + diagrams* behind them.

**Last updated**: 2026-05-25

---

## The problem we're solving

This product is a multi-tenant CRM where each tenant belongs to one *industry* (Education Consultancy, IT Agency, Construction, Real Estate, etc. — see `supabase/migrations/012_industry_customization.sql` for the seven seeded industries). Most features are **universal** (leads, pipeline, team), but some are **industry-specific** (student check-in is only for Education tenants; site-visit tracking might only be for Construction tenants).

How do you organize code so:

- Universal features stay shared
- Industry-specific features stay isolated
- Adding a new industry doesn't require touching every file
- Two devs working on different industries don't merge-conflict
- The same feature can be shared across multiple industries without copy-paste

The team had one pattern (now legacy). We moved to a better one (`src/industries/` modules). This doc explains both, so anyone can see the *why* behind the change.

---

## The old pattern (flat `src/features/`)

### Directory layout

```
src/
├── features/                              ← all features, flat, no industry awareness
│   ├── form-builder/
│   │   ├── components/
│   │   ├── templates/
│   │   └── lib/
│   └── (other features could land here)
│
├── components/dashboard/
│   ├── check-in-page.tsx                  ← "is this education-only? IT-only? both?" not visible from the file
│   ├── shell.tsx                          ← TWO sidebar arrays + a ternary
│   └── leads-table.tsx
│
├── app/(main)/(dashboard)/
│   ├── forms/page.tsx                     ← INLINE guard: industry_id !== 'edu' → <NotAvailable />
│   ├── check-in/page.tsx                  ← NO guard (oops, IT tenants saw this)
│   └── leads/page.tsx
│
└── app/(main)/api/v1/
    ├── form-configs/route.ts              ← maybe an inline guard, maybe not
    └── check-ins/route.ts                 ← no guard (oops)
```

### How industry gating worked (3 places per feature)

```
                      [tenant logs in]
                            │
                            ▼
              ┌──────────────────────────┐
              │  shell.tsx (the sidebar) │
              │                          │
              │  const navItems =        │
              │    industry_id ===       │
              │    "education_           │
              │     consultancy"         │
              │       ? EDUCATION_NAV    │  ← HARDCODED ternary
              │       : BASE_NAV;        │     touch this file for
              └──────────────────────────┘     EVERY new industry feature
                            │
                            ▼
              ┌──────────────────────────┐
              │  forms/page.tsx          │
              │                          │
              │  if (industry_id !==     │
              │       "education_...")   │  ← INLINE guard
              │     return <NotAvailable>│     friendly message,
              │                          │     but lives in N places
              └──────────────────────────┘
                            │
                            ▼
              ┌──────────────────────────┐
              │  /api/v1/form-configs    │
              │                          │
              │  ??? maybe a check       │  ← Often FORGOTTEN
              │  ??? maybe not           │     check-in API had no gate;
              │                          │     IT tenants could hit it
              └──────────────────────────┘
```

### What broke at scale

```
Scenario: Anish builds form-builder for Education.
          Sadin builds billing-board for IT-agency.
          (Same time, parallel branches.)

   Anish's branch                   Sadin's branch
   ──────────────────              ──────────────────
   M  src/features/                M  src/features/
      form-builder/ (new)             billing-board/ (new)
   M  shell.tsx                    M  shell.tsx
      (add Forms to                   (need IT_AGENCY_NAV array,
       EDUCATION_NAV array)            change ternary to handle
                                       3+ industries)
   M  forms/page.tsx (inline       M  billing/page.tsx (inline
      guard added)                    guard added)

                            ╲           ╱
                             ╲         ╱
                              ╲       ╱
                            git merge
                                  │
                                  ▼
                          shell.tsx CONFLICT
                       (both touched the ternary)

Adding the 4th industry?  shell.tsx ternary becomes:
   industry_id === 'edu' ? EDU
 : industry_id === 'it'  ? IT
 : industry_id === 'con' ? CON
 : industry_id === 're'  ? RE
 : BASE
```

**Net effect of the old pattern:**

- Every industry-scoped feature touched `shell.tsx` → merge conflicts on parallel work
- Industry gates scattered in 3 places per feature (sidebar, page, API)
- Easy to forget the API gate (check-in was actually ungated for IT tenants)
- No home for industry-specific AI prompts
- Sharing a feature between two industries meant duplicating the `if` checks everywhere

---

## The new pattern (industry modules at `src/industries/`)

### Directory layout

```
src/
├── app/(main)/(dashboard)/                ← UNIVERSAL features stay here, unchanged
│   ├── leads/                              every tenant gets these
│   ├── pipeline/
│   ├── team/
│   ├── settings/
│   ├── check-in/page.tsx                  ← thin shell (~10 lines)
│   └── forms/page.tsx                     ← thin shell (~10 lines)
│
├── components/dashboard/                  ← UNIVERSAL components stay here
│   ├── leads-table.tsx
│   ├── shell.tsx                          ← reads manifests, no more ternary
│   └── ...
│
└── industries/                            ← NEW: first-class architectural layer
    │
    ├── _registry.ts                       single source of truth for IDs
    │                                      (FEATURES.CHECK_IN, INDUSTRIES.EDUCATION_CONSULTANCY)
    │
    ├── _loader.ts                         single gate truth function
    │                                      (getFeatureAccess(industry, featureId))
    │
    ├── _types.ts                          IndustryManifest, FeatureMeta types
    │
    ├── _shared/features/                  cross-industry features (empty today)
    │
    ├── education-consultancy/             ← Anish's territory
    │   ├── manifest.ts                    declares: features[], sidebar[], ai
    │   ├── features/
    │   │   ├── check-in/
    │   │   │   ├── ui.tsx                 the actual component
    │   │   │   ├── detail-ui.tsx
    │   │   │   └── meta.ts                { id: CHECK_IN, industries: [EDU] }
    │   │   └── form-builder/
    │   │       ├── components/
    │   │       ├── templates/
    │   │       └── meta.ts
    │   └── ai/agent.ts                    reserved slot for education AI prompts
    │
    ├── it-agency/                         ← Sadin's territory
    │   ├── manifest.ts                    empty: features:[], sidebar:[]
    │   ├── features/                      (whatever Sadin builds lives here)
    │   └── ai/agent.ts                    reserved slot for IT AI prompts
    │
    └── (5 more industry stubs)            construction, real-estate, healthcare,
                                           recruitment, general
```

### How industry gating works now (1 truth, applied 3 places automatically)

```
            education-consultancy/manifest.ts
            ─────────────────────────────────
            export const manifest = {
              id: 'education_consultancy',
              features: [
                { meta: checkInMeta },
                { meta: formBuilderMeta },
              ],
              sidebar: [
                { featureId: CHECK_IN, label: 'Check-In', icon: 'UserCheck', href: '/check-in' },
                { featureId: FORM_BUILDER, label: 'Forms', icon: 'FileText', href: '/forms' },
              ],
              ai: aiConfig,
            }
                              │
                              │  (declarative — one file, one truth)
                              │
                ┌─────────────┼─────────────┐
                ▼             ▼             ▼
        ┌──────────────┬──────────────┬──────────────┐
        │  Sidebar     │  Page route  │  API route   │
        │              │              │              │
        │  shell.tsx   │  forms/      │  /api/v1/    │
        │  reads       │  page.tsx    │  form-       │
        │  manifest    │  calls       │  configs/    │
        │              │  getFeature- │  calls       │
        │  → renders   │  Access()    │  getFeature- │
        │    item if   │  → notFound  │  Access()    │
        │    in        │    if false  │  → 403       │
        │    sidebar[] │              │    if false  │
        └──────────────┴──────────────┴──────────────┘

        All three call the SAME getFeatureAccess() function.
        Change the manifest, all three change in lockstep.
```

### Parallel work — zero merge conflicts

```
   Anish's branch                   Sadin's branch
   ──────────────────              ──────────────────
   A  src/industries/              A  src/industries/
      education-consultancy/          it-agency/
      features/                       features/
      new-edu-feature/                billing-board/
   M  src/industries/              M  src/industries/
      education-consultancy/          it-agency/
      manifest.ts                     manifest.ts
      (one line added)                (one line added)

                            ╲           ╱
                             ╲         ╱
                              ╲       ╱
                            git merge
                                  │
                                  ▼
                       NO CONFLICTS — totally different files

   Adding the 4th industry? Create src/industries/<id>/manifest.ts
   from a stub. Don't touch any existing file.
```

---

## Side-by-side comparison

```
                        OLD PATTERN                    NEW PATTERN
                        ───────────                    ───────────

Where features live    src/features/<feature>/        src/industries/<industry>/
                       (flat — industry unclear)        features/<feature>/
                                                       (industry-owned)

Universal features     mixed everywhere in src/       src/app/(main)/(dashboard)/
                                                      and src/components/dashboard/
                                                      (clear two-homes rule)

Industry gate          3 separate places:             1 manifest, 3 auto-applied:
locations              - shell.tsx ternary            - sidebar reads manifest
                       - page inline if-check         - page calls getFeatureAccess
                       - API maybe-check              - API calls getFeatureAccess

Single source of       none — gates scattered         _registry.ts (IDs)
truth                                                 _loader.ts (gate function)
                                                      manifest.ts (registration)

Adding a new           1. Build feature in            1. Build feature in
industry-scoped           src/features/<f>/              src/industries/<id>/features/<f>/
feature                2. Edit shell.tsx ternary      2. Add one line to
                       3. Add page guard                  <id>/manifest.ts
                       4. Add API guard               3. Add page+API shell
                       5. Hope you didn't forget      (registry catches typos)
                          step 4

Parallel dev work      Conflicts on shell.tsx         Zero conflicts —
                       (and any file touched           different industry folders =
                        by both devs)                  different files

Cross-industry         Copy-paste folder + edit       Move to _shared/, opt-in
sharing                gate code per industry         per manifest (one line),
                       (= duplication, drift)         optional per-industry config

Per-industry AI        no home                        industries/<id>/ai/agent.ts
prompts                                               (slot reserved, stub today)
```

---

## The three feature categories (the rule that drives everything)

The new pattern works because every feature gets classified into one of three buckets:

```
┌──────────────────────────────────────────────────────────────────┐
│                                                                  │
│   UNIVERSAL                Used by every tenant regardless of    │
│   ─────────                industry.                             │
│                                                                  │
│   Examples: leads, pipeline, team, settings, AI chat             │
│   Lives at: src/app/(main)/(dashboard)/<feature>/                │
│             src/components/dashboard/<feature>.tsx               │
│   Manifest involvement: none                                     │
│                                                                  │
├──────────────────────────────────────────────────────────────────┤
│                                                                  │
│   INDUSTRY-SCOPED          Used by ONE industry only.            │
│   ────────────────                                               │
│                                                                  │
│   Examples: check-in (Education), form-builder (Education)       │
│             billing-board (IT, future), site-visits              │
│             (Construction, future)                               │
│   Lives at: src/industries/<id>/features/<feature>/              │
│   Manifest involvement: registered in that industry's            │
│             manifest.ts                                          │
│                                                                  │
├──────────────────────────────────────────────────────────────────┤
│                                                                  │
│   SHARED                   Used by MULTIPLE industries but not   │
│   ──────                   all.                                  │
│                                                                  │
│   Examples (hypothetical): document-collection (Education +      │
│             Real Estate), site-visits (Construction +            │
│             Real Estate)                                         │
│   Lives at: src/industries/_shared/features/<feature>/           │
│   Manifest involvement: each consuming industry's manifest opts  │
│             in, optionally passing per-industry config           │
│                                                                  │
└──────────────────────────────────────────────────────────────────┘

   "Promote, don't copy"
   ─────────────────────
   When a 2nd industry wants a feature that already lives in one
   industry's folder, MOVE it to _shared/ and have both industries
   opt-in. Never copy-paste folders between industries.
```

---

## The decision tree devs follow

```
Building a new feature?
│
├── Will every tenant use this, no matter the industry?
│   └── YES → Universal — src/app/(main)/(dashboard)/<feature>/
│             Don't touch src/industries/ at all.
│
├── Will only ONE industry use this?
│   └── YES → Industry-scoped — src/industries/<id>/features/<feature>/
│             Register in that industry's manifest.ts (one line).
│
└── Will multiple-but-not-all industries use this?
    └── YES → Shared — src/industries/_shared/features/<feature>/
              Each consuming industry's manifest opts in with one
              line, optionally passing config like
              { label, maxFiles, ... }.
```

---

## Why this matters for the long term

```
   At 2 industries today:
   ─────────────────────
   Old pattern works.  New pattern works.  Both fine.

   At 5 industries:
   ────────────────
   Old pattern: shell.tsx has a 5-way ternary or chained ifs.
                Industry gates drift between files.
                Adding "construction" requires touching every
                gated file.

   New pattern: 5 manifest files. Sidebar still uses one function
                call. Adding "construction" = create one manifest,
                drop features in.

   At 20 industries with rich per-industry features + AI:
   ──────────────────────────────────────────────────────
   Old pattern: not feasible. Refactor or rewrite.

   New pattern: 20 manifest files. Each industry has its own AI
                agent config, its own features, its own
                sidebar. Universal substrate (leads, pipeline,
                billing) stays single-source.
```

---

## Where to read next

- `CLAUDE.md § Industry Scoping Rules` — the rules + new-feature checklist + decision tree (more concise than this doc; this doc has the *why*).
- `CLAUDE.md § Tenant Isolation Rules` — separate concern from industry scoping, also important; covers `scopedClient(auth)` discipline.
- `docs/FEATURE-CATALOG.md` — human-readable list of every feature today and which industries use it.
- `src/industries/_registry.ts` — the single source of truth for feature IDs and industry IDs.
- `src/industries/_loader.ts` — the gate truth function (`getFeatureAccess`).
- Working examples in the codebase:
  - `src/industries/education-consultancy/manifest.ts` — populated manifest.
  - `src/industries/education-consultancy/features/check-in/` — full industry-scoped feature.
  - `src/app/(main)/(dashboard)/check-in/page.tsx` — thin route shell pattern.
  - `src/app/(main)/api/v1/check-ins/route.ts` — API gate pattern.
  - `src/lib/supabase/scoped.ts` — tenant-scoped query wrapper.
