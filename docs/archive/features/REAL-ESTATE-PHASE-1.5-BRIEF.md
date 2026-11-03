# BRIEF: `real_estate` Phase 1.5 — Capital-Raise Dashboard

**For:** Sonnet executor · **From:** Opus (planner) + `/coo-real-estate`
**Branch:** `feature/real-estate-vertical` (continue on it; HEAD is `b3c0626`)
**Date:** 2026-07-15 · **Scope:** The GP's landing screen. **No AI. No new migration. No new route.**

---

> ## ⛔ TWO GUARDRAILS THAT OVERRIDE EVERYTHING ELSE
>
> **1. DO NOT BREAK ANY OTHER TENANT.** education_consultancy, it_agency, travel_agency and every
> other tenant must render **byte-identically** after your change. The ONLY shared file you touch is
> `src/app/(main)/(dashboard)/dashboard/page.tsx`, and only as an **additive early-return
> `industry_id === "real_estate"` branch placed ABOVE all existing logic** — you do not edit, reorder,
> or wrap any existing education/it_agency/generic code path in that file. Everything else you create
> lives under `src/industries/real-estate/` (industry-owned) or a new `real-estate/` API folder. You
> MUST log in as an it_agency AND an education tenant and confirm their `/dashboard` is unchanged
> before you push (§6 step 5).
>
> **2. NO DATABASE WORK AT ALL.** Phase 1.5 adds **zero migrations** and **zero RPCs**. Aggregation is
> done in TypeScript in the API route over `scopedClient(auth)` queries (data is tiny; the existing
> `GET /api/v1/offerings` route already does exactly this — copy its shape). Do **not** run any SQL
> against local, stage, or prod. The demo data already exists (seed script, 2 offerings / 7 investors).

---

## 0. What this is

The real_estate tenant currently lands on the generic `/dashboard` (lead StatsCards + lead charts) —
meaningless for a capital-raise firm. Phase 1.5 replaces that, **for real_estate only**, with a
**Capital-Raise Dashboard**: the GP's at-a-glance view of the raise across **all** offerings.

It reuses the **it_agency sales-dashboard widget spine** — the self-fetching-widget pattern
(`useWidgetData` hook + `WidgetCard` shell + a server-aggregating `/api/v1/insights/...` endpoint) —
**by pattern, not by import.** You do not import any `it-agency/` file into `real-estate/`
(cross-industry import is banned; and each dashboard already keeps its own `widget-shell` copy —
delivery-dashboard and sales-dashboard each have one). You copy the ~30-line shell into the
real_estate feature folder, and you reuse the genuinely-shared `useWidgetData` hook from
`_shared/features/insights/lib/`.

**DEFERRED (do NOT build):** AI/auto-comms (Phase 2), time-series trends, per-investor drill-downs,
distributions/waterfall, configurable/movable widgets, the shared insights `DashboardRenderer` /
widget-catalog wiring. This is a **fixed** landing screen, not a user-configurable dashboard.

---

## 1. What the dashboard shows (metrics — all across ALL offerings)

One server round-trip feeds the whole screen. Sections:

**A. KPI tile row** (4 tiles, mirrors `sales-deals-summary.tsx`'s `Stat` grid):
| Tile | Definition |
|---|---|
| **Equity Raised** | `SUM(amount) WHERE status IN ('subscribed','funded')` across all offerings. Subtext: `X% of target`. |
| **Target Raise** | `SUM(target_raise)` across all non-`closed`/non-`draft` offerings (i.e. `status IN ('raising','funded','paused')`). |
| **Funded (AUM)** | `SUM(amount) WHERE status = 'funded'` across all offerings — capital actually in the door. |
| **Investors** | distinct `lead_id` with ≥1 non-`declined` commitment. Subtext: `Avg check $NNk` = `AVG(amount) WHERE status IN ('subscribed','funded') AND amount IS NOT NULL`. |

**B. Offerings progress** (one row per active offering): name · raised / target · a progress bar ·
status badge. This is the "equity-raised-vs-target across both offerings" the pitch centers on.

**C. Raise funnel** (across all offerings combined): the 4 `FUNNEL_COLUMNS`
(prospect → soft_commit → subscribed → funded) each as a column/bar showing **count** of commitments
and **$ total**. Reuse `FUNNEL_COLUMNS` + `COMMITMENT_STATUS_LABELS` from
`real-estate/lib/commitments.ts`. `declined` is excluded (off-funnel, same as the board).

---

## 2. Files to create (all industry-owned — zero cross-tenant risk)

### 2.1 API — the one aggregation endpoint
**`src/app/(main)/api/v1/insights/real-estate/summary/route.ts`**

Mirror the gating of `src/app/(main)/api/v1/insights/sales/deals-summary/route.ts` **and** the
JS-aggregation of `src/app/(main)/api/v1/offerings/route.ts` (GET). Exact shape:

```ts
import { authenticateRequest } from "@/lib/api/auth";
import { apiSuccess, apiUnauthorized, apiForbidden, apiError } from "@/lib/api/response";
import { scopedClient } from "@/lib/supabase/scoped";
import { getFeatureAccess } from "@/industries/_loader";
import { FEATURES } from "@/industries/_registry";
import {
  FUNNEL_COLUMNS,
  equityRaised,
  type Offering,
  type InvestorCommitment,
} from "@/industries/real-estate/lib/commitments";

export async function GET() {
  const auth = await authenticateRequest();
  if (!auth) return apiUnauthorized();
  // Gate on OFFERINGS (already enabled only for real_estate in its manifest) …
  if (!getFeatureAccess(auth.industryId, FEATURES.OFFERINGS)) return apiForbidden();
  // … plus defense-in-depth industry check, mirroring deals-summary's `!== "it_agency"`.
  if (auth.industryId !== "real_estate") return apiForbidden();

  const db = await scopedClient(auth);

  const { data: offData, error: offErr } = await db
    .from("offerings")
    .select("id, name, target_raise, status, currency")
    .is("deleted_at", null)
    .order("created_at", { ascending: true });
  if (offErr) return apiError("DB_ERROR", "Failed to load offerings", 500);
  const offerings = (offData ?? []) as unknown as Pick<
    Offering, "id" | "name" | "target_raise" | "status" | "currency"
  >[];

  const { data: cmtData, error: cmtErr } = await db
    .from("investor_commitments")
    .select("offering_id, lead_id, status, amount")
    .is("deleted_at", null);
  if (cmtErr) return apiError("DB_ERROR", "Failed to load commitments", 500);
  const commitments = (cmtData ?? []) as unknown as Pick<
    InvestorCommitment, "offering_id" | "lead_id" | "status" | "amount"
  >[];

  // group commitments per offering, reuse equityRaised() from commitments.ts
  const byOffering = new Map<string, Pick<InvestorCommitment, "status" | "amount">[]>();
  for (const c of commitments) {
    const arr = byOffering.get(c.offering_id) ?? [];
    arr.push({ status: c.status, amount: c.amount });
    byOffering.set(c.offering_id, arr);
  }

  const perOffering = offerings.map((o) => {
    const rows = byOffering.get(o.id) ?? [];
    const raised = equityRaised(rows);
    const target = Number(o.target_raise ?? 0);
    return {
      id: o.id,
      name: o.name,
      status: o.status,
      raised,
      target,
      pct: target > 0 ? Math.round((raised / target) * 100) : 0,
    };
  });

  const ACTIVE = new Set(["raising", "funded", "paused"]);
  const totalRaised = perOffering.reduce((s, o) => s + o.raised, 0);
  const totalTarget = offerings
    .filter((o) => ACTIVE.has(o.status))
    .reduce((s, o) => s + Number(o.target_raise ?? 0), 0);
  const fundedTotal = commitments
    .filter((c) => c.status === "funded")
    .reduce((s, c) => s + Number(c.amount ?? 0), 0);

  const investorIds = new Set(
    commitments.filter((c) => c.status !== "declined").map((c) => c.lead_id),
  );
  const checks = commitments
    .filter((c) => (c.status === "subscribed" || c.status === "funded") && c.amount != null)
    .map((c) => Number(c.amount));
  const avgCheck = checks.length ? Math.round(checks.reduce((a, b) => a + b, 0) / checks.length) : 0;

  const funnel = FUNNEL_COLUMNS.map((status) => {
    const rows = commitments.filter((c) => c.status === status);
    return {
      status,
      count: rows.length,
      amount: rows.reduce((s, c) => s + Number(c.amount ?? 0), 0),
    };
  });

  const currency = offerings[0]?.currency ?? "USD";

  return apiSuccess({
    currency,
    totalRaised,
    totalTarget,
    pctRaised: totalTarget > 0 ? Math.round((totalRaised / totalTarget) * 100) : 0,
    fundedTotal,
    investorCount: investorIds.size,
    avgCheck,
    activeOfferings: offerings.filter((o) => ACTIVE.has(o.status)).length,
    offerings: perOffering,
    funnel,
  });
}
```

Tenant isolation is guaranteed by `scopedClient(auth)` (auto `.eq("tenant_id", …)`). Read-only GET —
no `.update()/.delete()`, so no explicit-id-filter concern. **Counselor scoping is N/A** for Phase 1.5
(single GP owner; commitments carry no per-user assignment) — do not add lead-owner filtering here;
note it as a Phase-2 concern only.

### 2.2 Widget shell (copy, don't import)
**`src/industries/real-estate/features/capital-raise/widgets/widget-shell.tsx`** — copy verbatim from
`src/industries/it-agency/features/sales-dashboard/widgets/widget-shell.tsx` (`WidgetCard`,
`WidgetLoading`, `WidgetEmpty`, `WidgetError`). Update the top comment to say it mirrors the
sales/delivery shells for the real_estate capital-raise dashboard.

### 2.3 Presentational widgets (fed by props — the composer does the single fetch)
- **`.../capital-raise/widgets/kpi-row.tsx`** — 4 `Stat` tiles (copy the `Stat` component from
  `sales-deals-summary.tsx`). Wrap in a `WidgetCard title="Capital Raised"`. Money via `formatCurrency`
  from `real-estate/lib/commitments.ts` (NOT the travel `formatMoney`).
- **`.../capital-raise/widgets/offerings-progress.tsx`** — `WidgetCard title="Offerings"`; map
  `offerings[]` → row with name, `formatCurrency(raised)` / `formatCurrency(target)`, a Tailwind
  progress bar (`<div className="h-2 rounded bg-muted"><div style={{width: pct%}} .../>`), status badge.
- **`.../capital-raise/widgets/raise-funnel.tsx`** — `WidgetCard title="Raise Funnel"`; map `funnel[]`
  (already in `FUNNEL_COLUMNS` order) → 4 columns/bars, each `COMMITMENT_STATUS_LABELS[status]` +
  count + `formatCurrency(amount)`. Keep it simple (CSS bars or a small recharts bar — recharts is
  already a dep; match whatever `sales-funnel.tsx` does if you want visual parity).

### 2.4 The composer (one fetch, reuses `useWidgetData`)
**`src/industries/real-estate/features/capital-raise/capital-raise-dashboard.tsx`** — `"use client"`.
Single `useWidgetData<CapitalRaiseSummary>("/api/v1/insights/real-estate/summary")`. Render an `<h1>`
header ("Capital Raise" or the offering firm name), then loading/error/empty states from the shell,
then a responsive grid: KPI row full-width on top, then Offerings progress + Raise funnel below.
Define/export the `CapitalRaiseSummary` TS interface here matching §2.1's `apiSuccess` payload. Pass
data slices to the three presentational widgets.

---

## 3. The one shared-file edit (additive early branch)

**`src/app/(main)/(dashboard)/dashboard/page.tsx`** — add, immediately after the
`if (!tenantData) redirect("/login");` line and **before** the existing education/it_agency insights
redirect block:

```ts
if (tenantData.tenant.industry_id === "real_estate") {
  return <CapitalRaiseDashboard />;
}
```

with `import { CapitalRaiseDashboard } from "@/industries/real-estate/features/capital-raise/capital-raise-dashboard";`
at the top. That is the **entire** shared-file footprint. Everything below that line — the education/
it_agency redirect, the generic StatsCards/charts path — is untouched and unreachable for real_estate.
`CapitalRaiseDashboard` is a client component; `page.tsx` is a server component rendering it as a child
(fine — it fetches its own data client-side via `useWidgetData`, no server props needed).

> Why here and not a new `/capital-raise` route: real_estate already lands on `/dashboard` today (it
> doesn't match the education/it_agency redirect), and the universal "Dashboard/Home" nav item already
> points there. Branching in place makes the existing nav the GP landing with **zero** new sidebar
> entry and zero manifest change. Confirm during verification that the real_estate sidebar's dashboard
> item routes to `/dashboard`.

---

## 4. What you do NOT touch

- No migration, no RPC, no SQL (see Guardrail 2).
- No `_registry.ts` change — gating reuses `FEATURES.OFFERINGS` + the industry check. (Do **not** add a
  `CAPITAL_RAISE_DASHBOARD` id; nothing route-gates on it.)
- No `manifest.ts` change (no new sidebar item — reusing the universal Dashboard nav).
- No `shell.tsx` change.
- No shared insights `DashboardRenderer` / `getWidgetCatalog` change (that's the configurable-dashboard
  system; we're deliberately not using it here).
- No `it-agency/` file edited or imported.

---

## 5. Tenant-isolation checklist (verify before push)

- [ ] `dashboard/page.tsx`: only an additive `industry_id === "real_estate"` early return added; the
      diff shows **no** change to any line below it. `git diff` proves education/it_agency/generic paths
      byte-identical.
- [ ] New API route: `authenticateRequest()` → `getFeatureAccess(OFFERINGS)` → `industryId !== "real_estate"` forbid
      → `scopedClient(auth)`. Read-only. Returns **403** for an it_agency/education session.
- [ ] No new DB objects; no SQL run anywhere.
- [ ] No cross-industry imports (`grep -rn "it-agency" src/industries/real-estate/` → no widget/shell hit).

## 6. Local verification (as a real logged-in user)

Env note: build OOMs on this box — use `NODE_OPTIONS=--max-old-space-size=5632 npm run build`. Demo runs
on `:3001` (`npm run dev`); view from laptop via the documented SSH tunnel. All local logins pw
`edgexdev123`.

1. Data already seeded (2 offerings / 7 investors). If not: `scripts/seed-real-estate-demo.sh`.
2. `NODE_OPTIONS=--max-old-space-size=5632 npm run build` clean; `npm run dev`.
3. Log in **`owner@cre-capital.local`** (real_estate) → landing `/dashboard` shows the Capital-Raise
   Dashboard: KPI tiles (Equity Raised with % of target, Target, Funded/AUM, Investors + avg check),
   Offerings progress showing **both** Industrial Value-Add Fund II and Southeast Flex Portfolio I with
   distinct raised/target bars, and a combined Raise Funnel with counts + $ per column. Sanity-check the
   numbers against the seed (Fund II equity ≈ $1.2M, Flex ≈ $0.85M).
4. Hit `GET /api/v1/insights/real-estate/summary` in the browser while logged in as CRE → 200 + payload.
5. **Isolation:** log in **`admin@edgex.local`** (it_agency) and **`owner@admizz.local`** (education) →
   their `/dashboard` is exactly as before (no capital-raise UI); `curl`/browser
   `/api/v1/insights/real-estate/summary` → **403**.

## 7. Build order

1. API endpoint (§2.1) — verify payload via browser first.
2. Widget shell copy (§2.2) + 3 presentational widgets (§2.3).
3. Composer (§2.4).
4. Additive `dashboard/page.tsx` branch (§3).
5. Isolation checklist (§5) + local verification (§6).
6. `docs/FEATURE-CATALOG.md`: extend the offerings/real_estate row (or add a line) noting the
   capital-raise dashboard landing.
7. `NODE_OPTIONS=… npm run build`, then push the branch and report back for Opus review.

**Do not merge. Do not touch stage/prod DB. Push the branch and report back for Opus review.**
