# BRIEF — SMS Phase 3A: the send spine (registration, APIs, Inngest). No UI.

**For:** Sonnet executor session
**From:** Opus planning session, 2026-08-15
**Prerequisite:** PR #391 (Phase 2) merged to `stage` — **it is.** Branch from the latest `origin/stage`.
**Related:** `docs/SMS-PHASE1-BRIEF.md` §2 (live-verified provider facts — authoritative),
`docs/SMS-PHASE1-REVIEW.md`, `docs/SMS-PHASE2-BRIEF.md`.

Phase 3 is split in two because it is much larger than 1 or 2. **This is 3A: everything that makes a
blast actually send, with no screen attached.** 3B (`docs/SMS-PHASE3B-BRIEF.md`) builds the UI on
top of the contracts fixed here, and is written already — do not pull any of it forward.

**There is no user-visible surface in 3A.** No page, no sidebar entry, no component. Sadin will open
localhost and see nothing new; that is expected and is stated here so nobody goes looking. What you
*can* demonstrate is a blast sent end-to-end through the mock provider via `curl` + psql, and that
demonstration is required (§7).

---

## 0. Before you touch anything

1. Branch from the **latest** `origin/stage` (which now contains migrations 202–204 and all of
   `src/lib/sms/`). Use a **separate worktree**. **Do not touch `demo/cre-capital-local`** — Sadin
   has WIP there; do not stash, commit, or discard it.
2. **Copy this brief into your worktree and commit it with the PR.** The Phase 1 brief and review
   were written and never committed, and were lost — do not repeat that.
3. **No migration in 3A.** Everything you need exists in 202–204. Next free number stays **205** and
   belongs to Phase 4. If you think you need a schema change, stop and say so in your report instead
   of inventing one.
4. **Stop at the PR.** No merge, no flags, no stage/prod DB writes.

---

## 1. What already exists — build on it, don't re-derive it

| Piece | Where | Note |
|---|---|---|
| Credit reserve/settle | `sms_credits_reserve` / `sms_credits_settle` RPCs | **idempotent by `ref_id`** — a retried Inngest step is a safe no-op. Do not add your own guard on top. |
| Per-recipient truth | `sms_messages` + `uq_sms_message_blast_lead` | materialize rows up front; re-running a job can never double-send |
| Provider abstraction | `src/lib/sms/provider/` | `getSmsProvider()` falls back to **mock**; going live needs `SMS_PROVIDER=aakash` **and** a token |
| Sandbox redirect | `src/lib/sms/env-guard.ts` | `isSmsSandbox()` defaults **true** |
| Send path | `sendQueuedBatch(tenantId, messageIds[])` in `src/lib/sms/send.ts` | already attributes by phone, already enforces the suppression safety net |
| Suppression | `loadSuppressedPhones` / `suppressPhone` in `src/lib/sms/suppression.ts` | batch lookup, one query |
| Opt-out tokens | `getOrCreateOptOutToken` / `optOutUrl` in `src/lib/sms/optout.ts` | race-safe, one stable token per (tenant, phone) |
| Quiet hours | `resolveSendWindow(now, tz, startHour, endHour)` in `src/lib/sms/quiet-hours.ts` | pure; **not wired to anything yet — 3A wires it** |
| Segments | `countSegments` in `src/lib/sms/segments.ts` | the single source of truth for credits |
| Feature gate | `getFeatureAccess(industryId, FEATURES.X)` in `src/industries/_loader.ts` | |
| Filter engine | `src/lib/filters/` — `decodeFilterTree`, `planFilter`, `compileFilter`, `leadFields()` | |
| Lead visibility | `visibleLeadsBase({user, service}, tenantId, scope, opts)` in `src/lib/leads/visibility-query.ts` | the uncapped RPC path |

---

## 2. Registration — both halves, or the gate returns false

**Naming trap:** `/campaigns` in `education_consultancy` is **already taken** by a referral/
leaderboard feature. This is `FEATURES.SMS = "sms"`, route `/sms`, label "SMS". Never call it a
campaign here.

1. `src/industries/_registry.ts` — add `SMS: "sms"` to `FEATURES`.
2. New `src/industries/_shared/features/sms/meta.ts` — `industries: [INDUSTRIES.EDUCATION_CONSULTANCY]`.
   Shared folder, not the education folder: other tenants buy this later, and promoting after the
   fact is the thing the architecture doc tells us to avoid.
3. `src/industries/education-consultancy/manifest.ts` — push `{ meta: smsMeta }` onto `features[]`.
   **Do NOT add a sidebar entry in 3A** — the `/sms` route doesn't exist yet and a sidebar link to a
   404 would ship to stage. The sidebar item is 3B's first task.
4. `src/lib/api/permissions.ts` — add `canSendSms?: boolean` to `PositionPermissions` and
   `canSendSms: boolean` to the resolved shape, granted by the owner/admin override and `false`
   by default for everyone else (follow exactly what `canExport` does — same shape, same place).

---

## 3. Audience resolution — `src/lib/sms/audience.ts`

This is the module where a mistake texts the wrong people, so it gets its own file and its own tests.

```ts
export interface AudienceRow {
  leadId: string; phone: string;        // bare 10-digit, provider shape
  phoneE164: string;                    // normalized, suppression key
  lead: Record<string, unknown>;        // for {{merge}} resolution
}
export interface AudienceBreakdown {
  matched: number;                      // leads the filter matched, before exclusions
  sendable: AudienceRow[];
  excluded: {
    noPhone: number; foreignNumber: number; malformed: number;
    suppressed: number; duplicatePhone: number;
  };
}
export async function resolveAudience(auth, tree: FilterTree, opts): Promise<AudienceBreakdown>
```

**Non-negotiables:**

- **Resolve through the caller's own visibility**, exactly as `GET /api/v1/leads` does: build a
  `CompileCtx` (`tz`, `now`, `industryId`, `permissions` — the same structural cast the leads route
  uses at `src/app/(main)/api/v1/leads/route.ts:200-209`), get the registry from `leadFields(ctx)`,
  validate with `planFilter` (return every error, not the first), and run the query through
  `visibleLeadsBase(...)`. **A rep must never be able to blast leads they cannot see.** Do not
  hand-roll a `.eq("tenant_id", ...)` query here.
- **Soft deletes:** `deleted_at IS NULL`, always.
- **Phone classification** via `toProviderRecipient()` — every rejection lands in the matching
  `excluded` bucket, none are silently dropped.
- **Duplicate phones collapse to ONE message.** Two leads sharing a number must not both get texted;
  keep the first by a deterministic order (`created_at, id`) and count the rest in `duplicatePhone`.
  This is the one exclusion a reviewer will forget to check — test it explicitly.
- **Suppression is applied here**, via one batched `loadSuppressedPhones` call. Never per recipient.

---

## 4. API routes — `src/app/(main)/api/v1/sms/`

Every route, without exception:

```
authenticateRequest() → getFeatureAccess(auth.industryId, FEATURES.SMS) || apiForbidden()
→ isSmsEnabledForTenant(auth.tenantId) || apiForbidden() → scopedClient(auth)
```

Write routes additionally require `auth.permissions.canSendSms`.

| Route | Methods | Notes |
|---|---|---|
| `blasts/route.ts` | GET, POST | list (paginated) / create draft |
| `blasts/[id]/route.ts` | GET, PATCH, DELETE | PATCH only while `status='draft'`; DELETE is soft (`cancelled`) |
| `blasts/[id]/preview/route.ts` | POST | **the contract the whole UI hangs off — §5** |
| `blasts/[id]/send/route.ts` | POST | **§6** |
| `blasts/[id]/cancel/route.ts` | POST | only from `scheduled`/`queued`/`sending`; cancels remaining `queued` rows |
| `credits/route.ts` | GET | balance, reserved, recent ledger rows |
| `settings/route.ts` | GET, PATCH | `tenant_sms_settings`; PATCH admin-only |
| `suppressions/route.ts` | GET, POST, DELETE | manual DNC management; POST writes `reason='manual'`, `source='admin'`, `created_by` |

## 5. `POST /preview` — the contract

Returns, and 3B renders exactly this, so get the shape right the first time:

```jsonc
{
  "audience": { "matched": 0, "sendable": 0, "excluded": { "noPhone":0,"foreignNumber":0,"malformed":0,"suppressed":0,"duplicatePhone":0 } },
  "message":  { "encoding": "gsm7|unicode", "chars": 0, "segments": 0, "creditsPerRecipient": 0,
                "prefix": "Admizz: ", "footer": "Opt out: …", "overheadChars": 0 },
  "cost":     { "totalCredits": 0, "balance": 0, "balanceAfter": 0, "sufficient": true, "shortfall": 0 },
  "timing":   { "willSendAt": "ISO", "deferredByQuietHours": false, "localTimeLabel": "8:00 AM NPT, 16 Aug" },
  "samples":  ["fully rendered message 1", "…2", "…3"]
}
```

- **Credits are counted on the FINAL rendered string** — prefix + body + footer — via `countSegments`.
  Counting the raw body under-reports every estimate. `render.test.ts` already locks this in.
- `creditsPerRecipient` assumes a non-personalized body. If the body contains `{{merge}}` tokens,
  render all three samples from real leads and return the **maximum**, plus a
  `"personalized": true` flag — merge tags change the per-recipient length and the estimate must not
  quietly under-shoot.
- `timing` uses `resolveSendWindow` with `tenant_sms_settings.timezone ?? tenants.timezone ??
  'Asia/Kathmandu'`, honouring `quiet_hours_enabled`.
- The footer is real cost: ~44 characters, 28% of a GSM-7 credit and over half a Unicode one.
  `overheadChars` exists so 3B can show it as already-consumed budget.

## 6. `POST /send` — order matters

Do these in exactly this sequence:

1. **Re-resolve the audience server-side.** Never trust a count the client sends.
2. **Materialize all `sms_messages` rows** — `status='queued'`, fully rendered `body` (prefix + merge
   + footer with the recipient's own opt-out token via `getOrCreateOptOutToken`), `encoding`,
   `segments`, `estimated_credits`, `source='blast'`. Suppressed recipients get a row with
   `status='suppressed'` — an auditable record of who was *not* texted, not a silent skip.
   Insert with `ON CONFLICT DO NOTHING` so a retry is inert.
3. **Enforce `max_recipients_per_blast`** (default 500) — reject with the count, don't truncate.
4. **`sms_credits_reserve(tenant, estimate, 'sms_blast', blastId)`** — on failure return the
   `shortfall` so the UI can say how many credits are missing.
5. **Emit the Inngest event**, set `status='queued'`, stamp `reserved_credits`.

Materializing before reserving means we reserve against real rendered bodies rather than an estimate
of an estimate.

## 7. `src/lib/inngest/functions/sms-blast-send.ts`

Register it in the `functions` array in `src/app/api/inngest/route.ts` — **a function not in that
array never runs, and this has bitten the repo before.**

- `concurrency: [{ key: "event.data.tenantId", limit: 1 }]` — two blasts for one tenant must never
  interleave.
- `step.sleepUntil` for both scheduled sends and quiet-hours release. Do not build a scheduler.
  Out-of-window messages are written `status='deferred'` + `deferred_until` and released by the sleep.
- Batches of **100** (`MAX_RECIPIENTS_PER_CALL`) as memoized `step.run`s, `step.sleep("2s")` between
  them. Limits are undocumented; stay conservative.
- Each batch calls `sendQueuedBatch` — do not write a second send path.
- **`insufficient_balance` mid-blast:** stop, cancel remaining `queued` rows, settle what was sent,
  mark the blast `partially_failed`, and write a `sms_credits_low` notification (`notifications.type`
  is free text — no migration needed).
- **`invalid_token`:** abort immediately and log at error. Retrying is pointless; this means the
  box's IP changed or the token died.
- **Settle at the end** with `sms_credits_settle(tenant, blastId, reserved, actual, 'sms_blast')` —
  **pass the ref_type explicitly.** It defaults to `'sms_blast'`, and relying on that default is how
  mislabeled ledger rows come back in Phase 5.
- Update `sms_blasts` counters and `completed_at`; final status `sent` or `partially_failed`.

## 8. Two carried-forward fixes, both in this PR

- **Sandbox credit accumulation.** In `src/lib/sms/attribute.ts` the `sandboxed` branch still sums
  `totalCreditsCharged` per message row, so a sandbox run inflates the settle against a real balance.
  Now that 3A actually calls settle, fix it: in sandbox, count each distinct provider result once.
- **`p_ref_type` explicitly** at every settle call site (see §7).

## 9. Tests

- `audience.test.ts` — duplicate-phone collapse, each exclusion bucket, suppression applied,
  and **a permissions test proving a counselor's audience excludes leads outside their scope.**
  That last one is the whole reason `resolveAudience` goes through `visibleLeadsBase`.
- `preview` — credits computed on the final string including footer; `sufficient:false` returns the
  right `shortfall`.
- `send` route — reserve failure blocks the event; `max_recipients_per_blast` rejects; a re-POST is
  idempotent (no duplicate `sms_messages` rows).
- Inngest function — `insufficient_balance` mid-blast marks `partially_failed` and settles;
  `invalid_token` aborts.
- Keep DB-touching tests on the Phase 1/2 precedent: skip cleanly when local Supabase is down.

## 10. Verification before the PR

1. `npm run build`, `npx eslint --max-warnings 50 .`, `npm run test`, `npx tsc --noEmit` — all clean.
2. **End-to-end on the mock provider, required.** Seed ~20 local Admizz leads including at least one
   with no phone, one foreign number, one duplicate phone, and one suppressed. Then, by `curl`:
   create a blast → preview → confirm the counts match a hand-count in psql → send → watch the
   rendered bodies hit stdout → show in psql that `sms_messages` statuses are right, the suppressed
   row exists, ledger has `reserve` + `settle`, and `sms_blasts` counters match. **Paste that psql
   output in your report** — it is the deliverable that proves the spine works.
3. Confirm the tenant-mismatch path: as a non-education tenant, every `/api/v1/sms/*` route returns
   403.

## 11. Report back with

The diff summary; anything in this brief that was wrong or impossible; the §10.2 curl+psql
transcript; the four gate outputs; and explicit confirmation that no migration was created, no flag
was enabled, and nothing was merged.
