# Brief: F1 (cap bypass) + F2 (round-trip storm) — one branch, one PR

Findings context: `docs/BLAST-FINDINGS-2026-09-06.md`.
Branch from latest `origin/stage`. Both fixes ship together — same file, same test surface.
Do not merge incremental patches to stage separately.

---

## F1 — enforce the cap BEFORE compose/materialize

**File:** `src/app/(main)/api/v1/sms/blasts/[id]/send/route.ts`

**Confirmed mechanism (verified in review, do not re-derive):**
The dispatcher (`src/lib/inngest/functions/sms-blast-send.ts:33-40`) selects
`sms_messages` by `blast_id` + `status IN ('queued','deferred')` with **no gate on
`sms_blasts.status`**. A single over-cap call is safe (the 422 returns before
`inngest.send()` at L230). The bypass is retry-after-shrink:

1. Call 1: audience 16,000 vs cap 500 → composes + materializes 16,000 `queued` rows,
   *then* 422s. Rows are never rolled back.
2. Call 2: admin shrinks audience to 400 → all 16,000 lead_ids are in
   `alreadyMaterialized`, so `newSendable` is empty; cap check sees 400 ≤ 500 and passes.
3. `queuedTotalsRows` (~L198) totals **all** queued rows for the blast → reserves 16,000
   credits, not 400.
4. Event emitted; `loadBatchIds` picks up all 16,000 and sends them.

Separately, `recipients_total` is stamped from the shrunk audience while 16,000 rows are
queued — counters are wrong on this path too.

**Change:** move the `max_recipients_per_blast` check so it runs *before* `composeRow` /
`materializeInChunks`. It only needs `audience.sendable.length`, which is known as soon as
the audience is resolved. Keep the existing 422 shape and payload (`count`, `max`) exactly —
the UI reads those fields.

**Do NOT** "fix" this by deleting orphaned rows on the 422 path, or by having the dispatcher
join `sms_blasts.status`. Both leave the write-then-validate ordering in place. Fix the order.

**Tests (required):**
- Over-cap send → 422 **and** `sms_messages` row count for that blast is 0.
- Over-cap send → then a shrunk retry under the cap → reserves credits for the shrunk
  audience only, and dispatches only that audience. This is the regression that matters.
- Existing under-cap happy path unchanged.

---

## F2 — bulk-mint opt-out tokens

**Files:** `src/lib/sms/optout.ts`, `src/lib/sms/compose.ts`,
`src/app/(main)/api/v1/sms/blasts/[id]/send/route.ts`

**Problem:** `getOrCreateOptOutToken` does an upsert + select-back per recipient
(`optout.ts:36-57`), called from `composeRecipientMessage` (`compose.ts:58`). 16,000
recipients = 32,000 sequential PostgREST round trips, run 25-wide via
`COMPOSE_CONCURRENCY`. Local run died with `PGRST003 Timed out acquiring connection from
connection pool`. Not local-only: `src/lib/sms/concurrency.ts`'s own header records the
same fan-out killing local Supabase at 249 recipients in Phase 3B. On Supabase hosted the
PostgREST pool is not ours to size and is shared app-wide — a large blast can starve
unrelated requests for every tenant.

**Change:** add a bulk minting function, e.g.

```ts
export async function ensureOptOutTokens(
  db: ScopedClient,
  recipients: { phoneE164: string; leadId: string | null }[]
): Promise<Map<string, string>>
```

- Dedupe by `phone_e164` first (the same phone can appear twice in one audience).
- Per chunk of ~1,000: one `.upsert(rows, { onConflict: "tenant_id,phone_e164",
  ignoreDuplicates: true })` — keep `ignoreDuplicates: true`. **Do not** switch to
  `ignoreDuplicates: false` to get a RETURNING: that issues `DO UPDATE SET` on every
  column and would rewrite existing tokens. Token stability is the documented contract
  (`optout.ts:4-7`, migration 204) — a rewritten token breaks opt-out links in messages
  already delivered.
- Then a paginated `SELECT token, phone_e164` for those phones (use `fetchAllRows` — the
  1,000-row PostgREST cap applies here too) into the Map.
- Preserve the existing race-safety property: insert-then-select, never
  check-then-insert.

Then: call it once in the send route for the full recipient set before composing; change
`composeRecipientMessage` to take a resolved `token: string` instead of doing its own
lookup, making it pure and synchronous. `composeRow` no longer awaits DB work.

Once compose is synchronous, `COMPOSE_CONCURRENCY` / `mapWithConcurrency` on that path
becomes vestigial — remove it from this call site and update `concurrency.ts`'s header
comment to say so. Leave the helper itself in place if other callers use it (check first).

**Do NOT** fix this by raising `COMPOSE_CONCURRENCY`, setting `PGRST_DB_POOL`, or enabling
the local pooler. Those hide it again at the next scale step, which is how it reached
16,000 in the first place.

**Tests (required):**
- `ensureOptOutTokens` returns a stable token for a phone that already has one (assert the
  token value is unchanged after a second call).
- Duplicate phones in one audience → one row, one token, both recipients resolve to it.
- >1,000 distinct phones → all resolved (proves the pagination, mirrors the Section-5
  fixture approach that caught the 1,000-row cap).
- Preview/send parity unchanged: `compose.ts`'s existing contract is that preview and send
  build the identical final string. Do not let the placeholder-token path
  (`estimateFooter`) drift.

---

## Verification before PR

- `npm run test` — full suite green, no skips reintroduced.
- `npm run lint` (NOT `npx eslint` — it skips config and has reported 0 errors on a branch
  CI then failed). Report errors + warning count.
- Local blast-scale Section 3 at 16,000 against the restored local DB: must complete
  without `PGRST003`, and report wall-clock time for the compose+materialize phase before
  and after.
- **No email in this branch.** F3 (the hardcoded production sending domain) is a separate
  PR; until it lands, do not run Section 4 — local sends still go out from
  `noreply@edgex.zunkireelabs.com` on the real Resend account.

## PR

To `stage`, squash, 1 approval from ani-shh. Body must state: the confirmed retry-after-
shrink bypass chain, the round-trip reduction (32,000 → ~32), that token stability is
preserved, and the before/after Section-3 timing.

Stop at PR open. Do not merge, do not promote, do not start Section 4.
