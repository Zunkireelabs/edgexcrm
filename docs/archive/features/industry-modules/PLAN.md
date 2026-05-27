# Industry Modules — In-flight Brief

> Companion to `~/.claude/plans/update-claude-md-to-reflect-frolicking-octopus.md`. This brief lives in the repo for the team's reference during the work. After ship, `git mv` to `docs/archive/features/industry-modules/PLAN.md`.

**Started**: 2026-05-24
**Lead architect**: Sadin
**Implementing**: Claude

## Why

Build a scalable foundation for multi-industry development. Sadin's vision is an **AI-native operating system per industry tenant**. Today `industry_id` is a decorative column. We're making it a first-class architectural concept so:

- Sadin (IT agency) and Anish (education consultancy) can work in parallel without merge conflicts on shared files.
- Features can be **shared** across industries without code duplication (via `_shared/` and per-industry config).
- Industry-specific AI prompts have a natural home (`industries/<id>/ai/`).
- Adding a new industry is "create a manifest, drop in features" — no central registry edits.

## The pattern (Path C)

```
src/
├── app/(main)/(dashboard)/        ← UNIVERSAL features (every tenant)
├── components/dashboard/          ← UNIVERSAL components
└── industries/                    ← INDUSTRY layer
    ├── _registry.ts                 type-safe feature ID constants
    ├── _types.ts                    Manifest, FeatureMeta, SidebarItem types
    ├── _loader.ts                   manifest reader, gate truth, nav builder
    ├── _shared/features/            cross-industry shared features
    ├── education-consultancy/
    │   ├── manifest.ts              features, sidebar, ai config
    │   ├── features/
    │   │   ├── check-in/            (moved from src/components/dashboard/)
    │   │   └── form-builder/        (moved from src/features/)
    │   └── ai/agent.ts              stub
    ├── it-agency/manifest.ts        stub (Sadin's territory)
    ├── construction/manifest.ts     stub
    ├── real-estate/manifest.ts      stub
    ├── healthcare/manifest.ts       stub
    ├── recruitment/manifest.ts      stub
    └── general/manifest.ts          stub
```

## Three feature categories

| Category | Where | Example |
|---|---|---|
| **Universal** | `src/app/...`, `src/components/dashboard/...` | leads, pipeline, team, settings |
| **Industry-scoped** | `src/industries/<id>/features/<feature>/` | check-in, form-builder (today, education only) |
| **Cross-industry shared** | `src/industries/_shared/features/<feature>/` + opt-in via manifests | document-collection (future) |

## Decisions locked in

- **One tenant = one industry** (no hybrid tenants).
- **Hide entirely** when industry doesn't match (sidebar hidden, route 404, API 403).
- **Refactor Anish's form-builder** into the new structure — same pattern as check-in.
- **Two-homes rule**: universal stays in `src/app/`, industry-scoped lives in `src/industries/`.
- **Promote, don't copy**: when a 2nd industry wants an existing feature, move to `_shared/`, never copy-paste.
- **Type-safe feature IDs**: every reference goes through `_registry.ts` constants.

## Hardening (ongoing)

A `scopedClient(auth)` wrapper lands alongside the industry work to address the ~37 routes using raw `createServiceClient()` (which bypasses RLS). New routes should use the wrapper; legacy migration is tracked on STATUS-BOARD.

## What's NOT in this work

- AI per-industry prompts — slot is created (`industries/<id>/ai/`), real prompts come later.
- Full migration of all 37 service-role routes — 2 migrated as proof, rest is follow-up.
- Events → webhook dispatcher wiring — separate concern.
- Tenant switching / multi-tenant-per-user — future feature.
- Auto-generated feature catalog — manual `docs/FEATURE-CATALOG.md` for now; script later.
