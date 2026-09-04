# Lead Dedup — Phase B5 Brief: timeline label polish (intuitive wording)

> **Executor:** Sonnet. **Reviewer:** Opus. **Branch:** `feat/lead-dedup-phase-b`.
> **Display-only** — no DB/API/migration changes. One file:
> `src/components/dashboard/lead/activities/activities-panel.tsx`.

## Why

The submission timeline works, but it leaks internal jargon that confuses end users
(Admizz counselors): raw `lead.merged lead` rows, a `Backfill` source badge, and `Resubmission`.
Sadin's decisions:
- **Merge rows:** friendly label, **keep one row per merge**.
- **Source badge:** **hide it for `backfill`** records; keep real sources for live submissions.
- **Resubmission badge:** soften to **`Repeat`**.

## Changes (all in `activities-panel.tsx`)

1. **Friendly merge label** — in `getSystemActivityDescription`, add a case **before** the fallback:
   ```ts
   if (activity.action === "lead.merged") return "Duplicate record merged";
   ```
   (Keeps one row per merge, just friendly text instead of "lead.merged lead".)

2. **Hide the "Backfill" source badge** — in `SubmissionDetail`, only render the `created_via`
   badge when it is **not** `"backfill"`, and map values to friendly labels:
   ```ts
   const VIA_LABEL: Record<string, string> = {
     public_form: "Public form", public_api: "Public API",
     integration: "Integration", manual: "Manual",
   };
   // ...
   {submission.created_via !== "backfill" && (
     <Badge variant="secondary" className="text-xs">
       {VIA_LABEL[submission.created_via] ?? submission.created_via}
     </Badge>
   )}
   ```
   (Backfill-reconstructed records show no source badge; live ones show "Public form" etc.)

3. **Soften "Resubmission" → "Repeat"** — change the badge text in `SubmissionDetail` from
   `Resubmission` to `Repeat` (keep the amber styling).

## Verify

Display-only, reads existing data — verify **visually on the sadin lead**
(`http://localhost:3000/leads/399de337-3ab0-4bb9-aee3-99cfddda1f50`, logged in as Admizz) and/or a
synthetic lead: merge rows read "Duplicate record merged"; backfill entries show **no** source
badge; a live test submission shows "Public form"; resubmissions show "Repeat". **No data writes.**

CI gates: `npm run build` clean + `npx eslint --max-warnings 50` (0 errors — re-run it; build-clean ≠ lint-clean).

## Sonnet handoff prompt

> On branch `feat/lead-dedup-phase-b`, implement **B5** per `docs/LEAD-DEDUP-PHASE-B5-BRIEF.md` —
> a display-only polish of `src/components/dashboard/lead/activities/activities-panel.tsx`:
> (1) in `getSystemActivityDescription`, render `lead.merged` as "Duplicate record merged";
> (2) in `SubmissionDetail`, hide the `created_via` badge when it's `"backfill"` and map the other
> values to friendly labels (Public form / Public API / Integration / Manual); (3) rename the
> "Resubmission" badge to "Repeat". No DB/API/migration changes. Verify visually (no data writes),
> run both CI gates (`npm run build` + `npx eslint --max-warnings 50` → 0 errors), commit on the
> branch, stop at review, report what changed.
