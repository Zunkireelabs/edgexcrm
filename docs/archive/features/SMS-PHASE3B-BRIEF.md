# BRIEF — SMS Phase 3B: the blast surface (UI)

**For:** Sonnet executor session
**From:** Opus planning session, 2026-08-15
**Prerequisite:** **Phase 3A merged to `stage`.** 3B renders the contracts 3A fixes; starting early
means guessing at response shapes and rewriting. Branch from `origin/stage` after 3A lands.
**Related:** `docs/SMS-PHASE3A-BRIEF.md` (§5 preview contract is the spec for most of this),
`docs/SMS-PHASE1-BRIEF.md` §2 (provider facts — authoritative).

**This phase is all user-visible surface.** Screenshots of every screen below are part of the
deliverable, not optional — the standing rule is that a UI phase without a screenshot is unverified.

---

## 0. Before you touch anything

1. **STOP if 3A is not merged to `stage`.** Check with `gh pr view <n> --json mergedAt`.
2. Separate worktree. **Do not touch `demo/cre-capital-local`.**
3. Copy this brief into your worktree and commit it with the PR.
4. **No migration.** No new API routes either — if you find yourself needing one, the 3A contract was
   wrong: say so in your report rather than adding it quietly.
5. **Stop at the PR.** No merge, no flags.

---

## 1. Registration — the half 3A deliberately left out

3A registered `FEATURES.SMS` and the feature meta but **no sidebar entry**, because the route didn't
exist yet. Add it now, in `src/industries/education-consultancy/manifest.ts`:

```ts
{ featureId: FEATURES.SMS, href: "/sms", label: "SMS", icon: "MessageSquare",
  minRoles: ["owner", "admin"] }
```

**The icon must be the string `"MessageSquare"`, not an imported `LucideIcon`.** The manifest crosses
the Server→Client boundary and a non-serializable prop crashes the whole dashboard. Register the name
in the `INDUSTRY_ICONS` map in `src/components/dashboard/shell.tsx` if it isn't there already. This
is one of the two pitfalls called out in CLAUDE.md and it has bitten this repo before.

## 2. Pages — thin shells only

`src/app/(main)/(dashboard)/sms/page.tsx` and `sms/[id]/page.tsx`. Each does:

```ts
if (!getFeatureAccess(tenantData.tenant.industry_id, FEATURES.SMS)) notFound();
```

…then delegates to a component in `src/industries/_shared/features/sms/ui/`. No data fetching, no
business logic in the shell.

## 3. Components — `src/industries/_shared/features/sms/ui/`

**`sms-dashboard.tsx`** — credit balance card (balance, reserved, a low-balance banner below
`low_credit_threshold`), recent blasts table with status pills, "New blast" button.

**`blast-composer.tsx`** — name, body textarea, audience builder, live preview panel.
Reuse the existing advanced-filter builder (`src/lib/filters/use-advanced-filters.ts`) for the
audience — **do not build a second filter UI.** Lead-lists ("Stage" in the UI) is just one condition
in the tree. The encoded tree is what gets stored on the blast.

**`character-counter.tsx`** — the piece users will actually stare at:

```
147/160 · 1 credit · GSM-7        →  52/70 · 1 credit · Unicode
```

It must flip to Unicode **the instant** a Devanagari character is typed, and show the prefix +
footer as **already-consumed budget** rather than invisible overhead. Import `countSegments` from
`src/lib/sms/segments.ts` — the same module the server bills from. Never re-implement the math
client-side; if the counter and the charge disagree, users stop trusting both.
Make the Unicode transition prominent, not a subtle grey line: a 200-character Nepali message costs
**3 credits, not 2**, and Devanagari burns the pool ~2.3× faster than anyone expects.

**`cost-preview-dialog.tsx`** — renders `POST /preview` verbatim: matched vs sendable, every
exclusion bucket broken out (noPhone, foreignNumber, malformed, suppressed, **duplicatePhone**),
credits per recipient, total, balance before/after, and the three rendered samples. If
`sufficient:false`, show the shortfall and disable Send. If `deferredByQuietHours`, say plainly
*"Will send at 8:00 AM NPT, 16 Aug"* — the tenant-local label 3A returns, not a UTC timestamp.

**`send-confirm-dialog.tsx`** — the last line of defence. **The user must type the exact recipient
count to enable Send.** A red banner when sandbox is OFF: *"This will send real SMS to N real phone
numbers."* Do not soften this copy.

**`credit-ledger-table.tsx`** · **`suppression-list.tsx`** (view, manual add, remove) ·
**`sms-settings-form.tsx`** (sender label, quiet hours + timezone, opt-out footer,
max recipients per blast, low-credit threshold).

## 4. Behaviour rules

- Every mutating control is gated on `canSendSms`; viewers see read-only.
- The composer autosaves the draft — never lose a typed body to a refresh.
- After Send, route to `/sms/[id]` and poll for status while `queued`/`sending`.
- Empty states everywhere: no blasts, no credits granted yet, audience matched 0.
- The blast detail page shows per-recipient rows with their real status, including `suppressed` and
  `failed` with the provider's reason.

## 5. Verification

1. `npm run build`, `npx eslint --max-warnings 50 .`, `npm run test`, `npx tsc --noEmit`.
2. Logged into Admizz locally with `SMS_PROVIDER=mock`, walk the whole flow: build a blast against
   ~20 seeded leads → counter flips GSM-7→Unicode when you type Devanagari → cost preview matches a
   hand-count in psql → type-the-count confirm → send → 20 rendered bodies on stdout → detail page
   shows per-recipient statuses → ledger shows reserve + settle.
3. **Screenshots required:** dashboard, composer with the counter in both GSM-7 and Unicode states,
   cost preview, send-confirm (with the sandbox-off banner), blast detail, suppression list,
   settings.
4. As a **non-education** tenant: `/sms` 404s and the sidebar item is absent. As a **viewer**: no
   Send controls.

## 6. Report back with

Diff summary; anything in the 3A contract that turned out wrong; all screenshots; the four gate
outputs; and confirmation that no migration, no new API route, and no flag change were introduced.
