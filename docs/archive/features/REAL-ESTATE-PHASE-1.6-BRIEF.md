# BRIEF: `real_estate` Phase 1.6 — OS-ify (sidebar departments + subscription e-sign + data room)

**For:** Sonnet executor · **From:** Opus (planner) + `/coo-real-estate` + `/crm-expert`
**Branch:** `feature/real-estate-vertical` (continue on it; HEAD is `200c445`)
**Date:** 2026-07-15 · **Scope:** 3 builds — (A) sidebar departments, (B) subscription e-sign onboarding, (C) per-offering data room. **No AI.**

---

> ## ⛔ GUARDRAILS (override everything)
>
> **1. DO NOT BREAK ANY OTHER TENANT.** All shared-file edits are **additive `real_estate`-gated
> branches** placed alongside existing education/it_agency logic — never edit/reorder their branches.
> The shared files you touch: `src/components/dashboard/shell.tsx` (add an `isRealEstate` nav branch +
> one line in the `brandSuffix` map), `src/components/dashboard/lead/lead-detail-v2.tsx` (extend the
> existing real_estate branch), and the offering-detail page (industry-owned already). Log in as
> it_agency AND education and confirm their sidebar + lead detail are **byte-identical** before pushing.
>
> **2. DATABASE = LOCAL ONLY.** Build (C) adds ONE migration (`159_real_estate_offering_documents.sql`)
> applied via `scripts/migrate-apply.sh local` only. Never touch stage/prod DB. Verify the next number:
> `ls supabase/migrations | sort | tail` (our branch already has 156/157/158 → next is **159**).
> Build with `NODE_OPTIONS=--max-old-space-size=5632 npm run build`.

---

## BUILD A — Sidebar organized into departments (like it_agency)

**Problem:** real_estate falls into the generic FLAT sidebar fallback. it_agency/education render
**departmental sections** via hardcoded per-industry branches in `shell.tsx`. Give real_estate the same.

**A.1 — `src/components/dashboard/shell.tsx`, brand suffix.** In the `brandSuffix` map (~line 288) add:
```ts
real_estate: "capital",
```
(→ renders **EdgeX**capital, mirroring EdgeXagency.)

**A.2 — `shell.tsx`, add the real_estate nav branch.** The nav render (~line 425) is
`isEducation ? (...) : isItAgency ? (...) : (generic fallback)`. Insert a **new `: isRealEstate ? (() => {...})()`
branch BETWEEN the it_agency branch and the generic fallback** — do not touch either. Model it on the
it_agency branch (lines ~494-...): define a `reItem(href)` finder over `industrySidebarItems` for
manifest items, and compose universal items with `renderNavItem` + `navAllowed`. Structure:

```
Home                                    // renderNavItem {href:"/home", ...}, standalone (no header)
<NavSectionHeader "Intelligence">
  Dashboard            navAllowed("/dashboard")        renderNavItem LayoutDashboard
  Company Knowledge    navAllowed("/knowledge-bases")  renderNavItem Library   // NOTE label
<NavSectionHeader "Capital Raise">
  Investors            navAllowed("/leads")            renderNavItem UsersRound, label "Investors"
  Offerings            reItem("/offerings")            renderIndustryEntry
  Pipeline             navAllowed("/pipeline")         renderNavItem Kanban
  Data Room            reItem("/data-room")            renderIndustryEntry   // from manifest (Build C)
<NavSectionHeader "Investor Relations">
  (no items yet — render the header only if you can do so without an empty-section visual glitch;
   otherwise OMIT the header for now and add it when Distributions/Statements land. Executor's call —
   pick whichever looks clean. This is the one place to use judgment.)
<NavSectionHeader "People">
  Org Structure        navAllowed("/team")             renderNavItem Network, label "Org Structure"
  Leave                navAllowed("/leave")            renderNavItem CalendarClock
  Attendance           navAllowed("/attendance")       renderNavItem CalendarCheck
<NavSectionHeader "Comms">
  Inbox                navAllowed("/inbox")            renderNavItem MessageSquare
```

All icons (LayoutDashboard, Library, UsersRound, Kanban, Network, CalendarClock, CalendarCheck,
MessageSquare) are already imported in shell.tsx (used by the education/it_agency branches). For **Data
Room** use an existing imported folder-ish icon or add one import (e.g. `FolderOpen`) — and register
its string in `INDUSTRY_ICONS` if you reference it via the manifest.

**Tenant-safety:** other tenants never enter this branch (guarded by `isRealEstate`); education/it_agency
branches and the generic fallback are unchanged.

---

## BUILD B — Subscription e-sign onboarding (make "Subscribed" real)

**Problem:** the "Subscribed" funnel stage has no document behind it. Wire the **existing consent
e-sign gate** (education spine — generic + tenant-scoped) as the **Subscription Agreement**.

**Reuse (do not rebuild):** `consent_templates` + `lead_consents` tables, `src/lib/consent/pdf.ts`,
public `/api/public/consent/[token]` route, and the `ConsentCard` / `SendConsentDialog` /
`InPersonConsentDialog` components already imported into `lead-detail-v2.tsx` for education.

**B.1 — Seed a real_estate consent template** (demo data → add to `scripts/seed-real-estate-demo.sh`,
NOT a migration): insert one `consent_templates` row for the CRE tenant — `title = "Subscription
Agreement"`, a short body (subscription/accreditation acknowledgment placeholder), `is_active = true`,
`require_drawn_signature` per your call. `ON CONFLICT (tenant_id) DO NOTHING`. (One template per tenant
is the existing model — fine for the demo's single sub-doc.)

**B.2 — Render the consent card in the real_estate investor detail.** In `lead-detail-v2.tsx`, the
existing `isRealEstate` branch renders `InvestorProfileCard + CommitmentsPanel + ManagementPanel`. Add
`<ConsentCard ... />` there (same props education passes), **relabeled "Subscription Agreement."**
- **Executor check:** confirm `ConsentCard`'s heading/labels come from the template/props, not a
  hardcoded "Student Consent" string. If they're education-hardcoded, pass a label prop or add a
  minimal `industryId`/`title` prop rather than forking the component. If the component is deeply
  education-coupled, flag it — do NOT copy-paste a divergent version; we'd promote it to `_shared`
  instead (raise it for Opus decision).

**B.3 — No new API/migration.** The consent flow's routes already exist and are tenant-scoped.

**Result:** on an investor, IR can send a Subscription Agreement e-sign link; signing records a
`lead_consents` row + PDF — so moving to "Subscribed" now has a real artifact.

---

## BUILD C — Per-offering data room

**Problem:** no document vault per offering (PPM / Operating Agreement / financials) — a competitor
table-stake. Reuse the presigned upload spine.

**C.1 — Migration `159_real_estate_offering_documents.sql`** (local-first; self-recording; additive):
```
offering_documents
  id UUID PK default gen_random_uuid()
  tenant_id   UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE
  offering_id UUID NOT NULL REFERENCES offerings(id) ON DELETE CASCADE
  name         TEXT NOT NULL
  storage_path TEXT NOT NULL                 -- object key in the bucket
  content_type TEXT
  size_bytes   BIGINT
  doc_type     TEXT                          -- ppm | operating_agreement | financials | other (optional)
  uploaded_by  UUID REFERENCES auth.users(id) ON DELETE SET NULL
  created_at   TIMESTAMPTZ DEFAULT now()
  deleted_at   TIMESTAMPTZ
```
RLS: SELECT `tenant_id IN get_user_tenant_ids()`; INSERT/UPDATE/DELETE `is_tenant_admin(tenant_id)`.
Index `(tenant_id, offering_id) WHERE deleted_at IS NULL`. Ends with the `schema_migrations` self-record.

**C.2 — Storage:** reuse the existing presigned-upload route (`src/app/(main)/api/v1/upload/route.ts`
→ bucket `lead-documents`) with an offering-scoped path prefix, OR a dedicated bucket if trivial —
prefer reusing `lead-documents` to avoid bucket setup. Record the returned path in `offering_documents`.

**C.3 — API** (gated, industry-owned): `src/app/(main)/api/v1/offerings/[id]/documents/route.ts`
(GET list + POST create-metadata-after-upload) + `documents/[docId]/route.ts` (DELETE soft). Same gating
as the other offerings routes: `authenticateRequest → getFeatureAccess(OFFERINGS) → industryId !== "real_estate" forbid → scopedClient`;
explicit `.eq("id", …)` on mutations.

**C.4 — UI:** a **Documents / Data Room** section on the offering detail
(`src/industries/real-estate/features/offerings/pages/offering-detail.tsx`) — list docs (name, type,
uploaded date), upload button (reuse the upload flow), delete. Keep it simple.

**C.5 — Nav item:** add a `Data Room` entry to the real_estate manifest sidebar (href `/data-room`) and
a thin `/data-room` route shell (gated `getFeatureAccess(OFFERINGS) → notFound()`) that lists documents
across offerings (or just links to offerings for now). The Build-A nav branch references it via `reItem("/data-room")`.

**C.6 — Seed:** optionally add 1-2 placeholder doc rows for the demo offerings in the seed script
(pointing at a dummy path) so the Data Room isn't empty — only if a real uploaded object exists; else
leave empty (empty state is fine).

---

## Tenant-isolation checklist (verify before push)

- [ ] `shell.tsx`: new `isRealEstate` nav branch + 1 `brandSuffix` line ONLY; `git diff` shows education/
      it_agency branches + generic fallback byte-identical.
- [ ] `lead-detail-v2.tsx`: consent card added only inside the existing `isRealEstate` branch.
- [ ] `offering_documents`: `tenant_id` + RLS (`get_user_tenant_ids` / `is_tenant_admin`); documents API
      gated + `scopedClient`; returns 403 for it_agency/education.
- [ ] No cross-industry import into `src/industries/real-estate/` (`grep -rn "it-agency" src/industries/real-estate/`).
- [ ] One migration (159), local only, self-recording; no SQL against stage/prod.

## Local verification

1. `scripts/migrate-apply.sh local --dry-run` shows only 159 pending → apply; re-run seed script.
2. `NODE_OPTIONS=--max-old-space-size=5632 npm run build` clean; `npm run dev` (:3001).
3. **real_estate** (`owner@cre-capital.local`): sidebar shows the departments (Intelligence / Capital
   Raise / People / Comms), brand reads **EdgeX**capital; investor detail has a **Subscription Agreement**
   card (send + sign works, records a `lead_consents` row); offering detail has a **Data Room** (upload +
   list + delete).
4. **Isolation:** `admin@edgex.local` (it_agency) + `owner@admizz.local` (education) → sidebar + lead
   detail **unchanged**; `/api/v1/offerings/<id>/documents` → **403**.

## Build order

1. Build A (sidebar branch + brand) — smallest, immediate demo polish. 2. Build B (consent seed + card).
3. Build C (migration → API → offering-detail UI → nav item → route shell). 4. Isolation + verification.
5. `docs/FEATURE-CATALOG.md` update. 6. Build, **push, stop for Opus review. Do NOT merge, no PR, no stage/prod DB.**
