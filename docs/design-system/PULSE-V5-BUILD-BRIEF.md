# Pulse v5: build brief (EDGEX-82 visuals, round 2)

**From:** Opus lead (edgexcrm-69). **For:** the executor (edgexcrm-2d). **Approved by:** Sadin, 2026-11-05.
**Branch:** keep working on `feature/EDGEX-82-pulse-slice1` in `../edgeXcrm-EDGEX-82`.
**STOP POINT: commit locally only. No push, no PR edits, until Sadin signs off on his local click-through.**

## The spec is the mockup. Match it exactly.
These live in `/Users/sadinshrestha/Projects/edgeXcrm-EDGEX-84/docs/design-system/mockups/`:
- **`pulse-v5-s1.png` + `pulse-v5.html` (scene `?scene=s1`): THE page.** Build it, region by region, to match.
- `pulse-v4-s3.png`: the person drawer and evidence drawer.
- `pulse-v4-s2.png`: shows how the AI layer behaves when the LLM is on. Reference only; don't build the Orca rail now.
- `DESIGN-SYSTEM-V2.md` (next to them): tokens, components and rules. §5 (AI language, Preview mode) is binding.
- Open `pulse-v5.html` in a browser for exact sizes and colours. Don't eyeball the PNG.

**Out of scope:** the new sidebar shown in the mockup. That's a separate ticket (the shell rollout). Keep today's sidebar.

## Regions, in page order (v5-s1)
1. **Header:**
   - Title "This week at {tenant short name}" (the label follows the window: Today / This week / Last 30 days / custom range).
   - A **computed lede**: "{new leads} new leads · {students} students reached Applications · {n} things need you".
   - On the right: segmented Today / 7 days / 30 days / Custom, the branch select, and a ghost Export.
2. **Briefing card (AI surface, Preview mode):**
   - **Visual:** gradient wash, 2px blue→violet top line, gradient sparkle badge, "Preview" tag, and a provenance byline "Orca · {generated time} · from {N} activity records" (N = the real count used).
   - **Up to 3 items.** Each has an icon tile, a bold headline sentence plus a plain follow-on, an evidence line with a label ("Evidence" / "What works" / "Pattern"), and a right-aligned link ("34 leads →") that opens the evidence drawer.
   - **Content comes from a pure function** `buildBriefing(numbers, signals)` with deterministic templates:
     - (a) the biggest negative KPI move, explained by its largest contributing branch and person
     - (b) the top win
     - (c) the biggest stage leak with its top reason
   - **Never print a line whose data you don't have.** Example: if time-to-first-call isn't computed, use a different, real evidence line.
   - **Ask box:** a gradient-border field with 2 suggested chips. If the existing AI assistant is enabled for the tenant (`src/lib/ai/flag.ts`), clicking opens the existing Ask Orca panel prefilled with the question. Otherwise it's disabled, with the tooltip "Orca answers switch on soon".
3. **Metric strip:** 4 tiles in one bordered strip.
   - Label, with the change top-right.
   - Big number and a sparkline.
   - A caption: "{prev} last week · {conversion} of {stage}" (conversion = your ≤100% base definition).
4. **Needs your attention:** this ONE list replaces both "Key changes" and "Needs you".
   - Filter pills: All / Needs action / Heads-up / Wins, with counts.
   - Section labels.
   - Rows: `icon · Subject · what happened … key figure · [Action with the concrete value] ›`
   - Rule-generated suggestions carry the gradient "Suggested" tag. The concrete action comes from the data: for example, the reassign target = the same-role person with the lightest load this window.
   - The first item is expanded by default: why sentence · meta line · links · Dismiss (store dismissals per user per window, in local state for now).
5. **Team scoreboard:**
   - Column groups: Intake / Moved to (Pre-qual, Qualified, Prospects, Apps, Back) / Activity (Status, Notes, Calls) / Results · delivered (Prospects, Students, Filed).
   - Role group subtotal rows and a Team total row.
   - Each person cell: name, branch, plus at most ONE gradient AI row note from the signals ("Stopped Wednesday · check in first").
   - Rule flags: a 2px red or amber row edge.
   - Change vs usual sits in a fixed slot and shows only when ≥25% off and usual ≥5.
   - `0` faint = none, `–` = not this role.
   - Hover card: this week / usual / last week. Click: the evidence drawer.
   - Sticky header and first column. Horizontal scroll below 1280px.
6. **Drawers:** match `pulse-v4-s3.png` (person view and evidence list, the "credited to whoever held the lead before the move" line).

## Tokens
Add the v2 tokens from `DESIGN-SYSTEM-V2.md` §2 as CSS variables **scoped to the Pulse root** (e.g. a `pulse` class on the
page wrapper), so no other page changes in this ticket. Inter is already the app font. Use tabular numbers. Gradients
appear only on AI elements.

## Honesty rules (binding)
- Every sentence in the briefing, every Suggested tag and every row note is computed from real data and links to its
  records.
- The "Preview" tag stays until the LLM layer (EDGEX-83) replaces the text.
- If a tenant's AI is fully off: keep the rule content, drop the gradient/AI styling and the Preview tag (the AI-off
  state).

## Gates before you report (no push)
1. Build, `npx eslint --max-warnings 50`, and `npm run test` all green. Add unit tests for `buildBriefing` (each
   template, missing-data skips) and for the suggestion-target selection.
2. Screenshot your local build at 1440px wide, with the story seed and the 7-day window. Put it **side by side with
   `pulse-v5-s1.png`, region by region**, and write a gap list. Fix the gaps until there are none you can't explain.
3. Re-run the 1.0s performance gate.
4. Report to edgexcrm-69. I verify in the browser before Sadin sees it.

## Addendum (2026-11-05, Sadin): AI paragraph block
- **The briefing card now opens with "Orca's read":** a 2–3 sentence summary on a soft gradient wash block (see
  `pulse-v5-s1.png`), above the 3 insight rows.
  - In Preview mode it's built by `buildBriefing()` from the top signals.
  - Omit it when there are fewer than 2 meaningful signals.
- **Any AI-written paragraph uses the same wash block** with a sparkle label: the expanded attention-row "why" ("Why
  Orca suggests this") and the person-view coaching note. Rule-only text (AI fully off) renders plain.
