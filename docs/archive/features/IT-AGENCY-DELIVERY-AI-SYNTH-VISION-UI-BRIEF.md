# it_agency Delivery — AI-Synth **Vision UI** Brief (preview only, NO backend)

**For:** Sonnet executor · **Reviewed by:** Opus · **Branch:** `feature/it-agency-delivery-and-ui` (same combined branch — do NOT branch off stage)
**Status:** READY TO BUILD · **Depends on:** nothing (pure frontend) · **Size:** S–M

---

## 0. Read this first — what this is and is NOT

This builds a **flag-gated, non-functional PREVIEW** of where AI-assisted delivery is heading, so we have a tangible artifact to look at and so the *seam is designed now* — before any real AI exists. It ships **no LLM calls, no API keys, no new dependencies, no writes, no migration.** It is a **vision placeholder**, clearly labeled as such, that later graduates into the real AI surface with zero layout rework.

**Why now:** the delivery cockpit already captures rich structured signal (`project_events` ledger + health/%-complete/budget/milestones/issues/CRs/status reports). "AI synth" = an assistant reading that exhaust and **drafting** the status narrative / project summary for a human to edit and publish. We are NOT building that engine yet (separate track: `docs/ai-native-efforts/`). We are building the **UI shell it will live in**, driven by *sample* content, so direction is visible and reviewable.

**Hard non-goals (do not cross):**
- ❌ No `anthropic`/`ai`/`@ai-sdk`/`langfuse` installs. No network calls to any model.
- ❌ No new API routes, no new DB tables, no migration.
- ❌ No writes to real records. The preview never persists anything.
- ❌ Do not make it *look* finished/working to a real tenant — every surface carries a visible **"Preview"** treatment.

---

## 1. Guardrails — the feature flag

The preview must be **OFF for real tenants** (Admizz, Mobilise) and **ON only for dogfood** (Zunkiree Labs) **+ admin/owner**. Keep it dead simple:

- Add a tiny config helper, e.g. `src/industries/it-agency/features/project-board/lib/ai-preview.ts`:
  ```ts
  // Vision-only preview flag. NO real AI behind this. Remove/replace when the
  // real AI-synth surface lands (docs/ai-native-efforts/).
  export const AI_SYNTH_PREVIEW = {
    // ON only for the Zunkiree dogfood tenant + admins. Real tenants never see it.
    enabledFor(tenantSlug: string | null | undefined, isAdmin: boolean): boolean {
      return isAdmin && tenantSlug === "zunkireelabs-crm";
    },
  } as const;
  ```
- The cockpit already knows `isAdmin`. Thread the **tenant slug** down to `ProjectCockpitPage` from the route shell (`getCurrentUserTenant()` already returns the tenant; pass `tenant.slug`). Gate both preview surfaces on `AI_SYNTH_PREVIEW.enabledFor(slug, isAdmin)`.
- If the flag is false, **nothing renders** — no empty gap, no disabled button.

---

## 2. Scope — exactly two surfaces (resist adding more)

### Surface A — "✨ Draft with AI" on the Status Reports panel
**File:** `src/industries/it-agency/features/project-board/components/cockpit/status-reports-panel.tsx`

- Add a secondary button near the "New status report" action: **`✨ Draft with AI`** with a small **"Preview"** pill next to it.
- On click, open a panel/sheet titled **"AI-drafted status report · Preview"** containing:
  1. A **"What the AI will read"** strip showing the project's *real* signals (cheap, no AI): current health (real value from `health-banner` source), real `% complete`, count of `project_events` since the last published report, open issues count, open CRs count. This is honest — it shows the actual substrate.
  2. A **sample drafted narrative** in the structured shape we're standardizing on — **Accomplishments / In progress / Risks / Asks / Recommended client message** — filled with clearly-marked *sample* text (see §3). Header badge: **"Sample preview — AI drafting is not yet live."**
  3. Two disabled buttons: **"Edit & use draft"** and **"Regenerate"**, each with a tooltip: *"Coming soon — connects to the AI assistant."*
- Nothing is saved. Closing the panel discards.

### Surface B — "AI Summary" card on the cockpit Overview
**File:** `src/industries/it-agency/features/project-board/pages/project-cockpit.tsx` (Overview tab), as a new component `components/cockpit/ai-summary-card.tsx`.

- A card at the **top of the Overview tab** (above `BriefEditor`), titled **"✨ Project pulse"** with a **"Preview"** pill.
- Body: a short **sample** plain-English synthesis (2–4 sentences) of "state of this project" — what changed recently, the one risk to watch, the recommended next action — again clearly badged **"Sample preview."**
- A subtle footer line: *"Soon: this updates automatically from your project's activity."*
- Optional single affordance: a disabled **"Ask about this project"** input stub (placeholder text only) — include only if it's cheap; skip if it complicates.

---

## 3. Sample content approach (honest, not fake-working)

The narrative text is **static sample copy**, but wrap the *real* signals around it so it teaches the concept truthfully:
- Real: health, %-complete, event/issue/CR counts (already available in the cockpit's data).
- Sample: the prose narrative and the "recommended client message." Prefix with a muted badge so no one mistakes it for a live draft.

Do **not** build a deterministic string-templating engine that stitches events into fake prose — that risks looking done and is throwaway. A single well-written hardcoded sample per section is enough to convey the vision. Put the sample copy in a local `const` in the component with a comment: `// SAMPLE PREVIEW COPY — replaced by real AI output when the assistant lands.`

---

## 4. Visual treatment (so it always reads as "preview")

- A consistent **"Preview"** pill (muted/outline, sparkle icon) on every AI surface. Reuse existing badge/pill primitives — no new design system.
- Sample regions get a subtle tint or dashed border + the "Sample preview" caption.
- Sparkle (`Sparkles` from lucide) as the AI motif, used consistently.
- Match the cockpit's existing card/spacing idiom exactly (look at `health-banner.tsx`, `status-reports-panel.tsx` for the house style). This should feel native, just clearly forward-looking.

---

## 5. How it graduates (design intent — build so this is true)

When the real AI foundation lands (`docs/ai-native-efforts/` Phase 1/2), the ONLY changes should be:
- The disabled buttons wire to the streaming assistant endpoint.
- The sample copy is replaced by live model output.
- The flag flips from tenant-gated preview to entitlement-gated real feature.

No relocation, no restructure. If you find yourself building anything that would have to be *torn out* rather than *wired up*, stop and flag it.

Also note the natural pairing: the structured sections here (Accomplishments/Next/Risks/Asks) are the same structure proposed for the real **structured status-report sections** backlog item (PM#3). If that ships first, Surface A's button sits directly on the real sections instead of sample ones — even better.

---

## 6. Acceptance checklist (Opus reviews before merge)

- [ ] `npm run build`, `npx tsc --noEmit`, `npx eslint src` all clean.
- [ ] **No** new deps in `package.json`; **no** network calls; **no** new API route or migration.
- [ ] Logged in as **Zunkiree admin**: both surfaces visible, clearly badged "Preview," disabled actions have "coming soon" tooltips, nothing persists.
- [ ] Logged in as a **non-admin** in Zunkiree: surfaces **hidden** (flag is admin-gated).
- [ ] Logged in as **any Admizz/Mobilise user**: surfaces **completely absent** (no gap, no flash).
- [ ] Real signals shown (health/%-complete/counts) are accurate for the project; narrative is clearly marked sample.
- [ ] Cockpit layout unchanged when the flag is off.

---

## 7. Out of scope / explicit non-goals

No real AI, no API keys, no streaming, no writes, no persistence, no new tables/routes/deps, no cross-industry exposure (it_agency + Zunkiree only), no notifications, no "Ask" chat wiring. This is a **vision placeholder** — its whole job is to make the direction visible and to pre-shape the seam. Keep it small.
