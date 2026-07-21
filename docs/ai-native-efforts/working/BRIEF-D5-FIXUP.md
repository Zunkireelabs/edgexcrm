# BRIEF — D5 flag fixup (Opus review findings)

**Branch:** stay on `feature/ai-per-tenant-flag`. Work is uncommitted in the working tree — that's expected. Do **not** commit, push, or open a PR.

Both parts of the D5 brief were built correctly and all gates are green (build 0, 242 tests, lint 0 errors/46 warnings, tsc 0). Two must-fixes. The first is the important one: the per-tenant gate currently has a hole at the highest-risk moment of the rollout.

---

## Finding 1 — BLOCKER: ingestion can bypass the per-tenant gate entirely

`scripts/backfill-kb-ingestion.ts` is a **third ingestion entry point**, missed by the original brief (my omission, not yours):

- **line 35** — `raw.from("tenants").select("id")` enumerates *every* tenant with no `ai_enabled` filter
- **line 63** — gates on `isIngestionEnabled()` only: the env flag, not the tenant grant
- **line 56** — emits `kb/item.ingest.requested` for every item it finds

Running that script on prod with `AI_INGESTION_ENABLED=true` sends **every tenant's documents — Admizz's included — to OpenAI**, with the consent gate fully in place and doing nothing. `src/lib/ai/ingestion/kb-ingest.ts` has no tenant check either, so nothing downstream catches it.

This is the exact tool someone reaches for the first time AI is enabled on prod ("index the existing documents"). It has to be closed.

### Do — gate at the egress point, not per caller

**Primary fix: gate inside `kb-ingest.ts` itself**, before any text is sent for embedding. Every path — route, backfill script, event replay, a hand-fired Inngest event — converges on that function, so one check there makes the guarantee hold regardless of caller. Duplicating the check across callers does not; the next new caller reintroduces the hole.

The function already has `tenantId` from the event payload. Check `isIngestionEnabledForTenant(tenantId)` early, before parse/embed.

When disabled:
- **Send nothing to OpenAI.** No parse call, no `embedTexts`. This is the whole point.
- Do **not** mark the item `failed` — a disabled tenant isn't an error. Skip cleanly and leave the item in a sane state (`ready` matches what the route's disabled path already does; if you choose differently, justify it).
- Make it observable — the existing trace/log seam is fine. A silent skip is hard to debug when someone wonders why a backfill did nothing.

**Secondary fix: `scripts/backfill-kb-ingestion.ts`** should also filter to AI-enabled tenants at line 35 rather than relying solely on the function-level gate, and say plainly in its output how many tenants it skipped and why. Defense in depth, and it stops the script from generating thousands of no-op events.

### Tests

- `kb-ingest` with a disabled tenant → embedding/parse functions **never called** (assert on the mock), item not marked `failed`, no chunks written.
- `kb-ingest` with an enabled tenant → unchanged from today.
- Backfill script skips disabled tenants and reports the skip count.

The first test is the one that matters — assert the *absence* of the outbound call, not just the absence of chunks.

---

## Finding 2 — migration number collision

`172_tenant_ai_enabled.sql` collides with `172_ai_write_actions.sql` (Phase 4A, on `feature/ai-phase-4-writes`). `173` is taken by 4C on that same branch. You correctly flagged this — now fix it.

"Next free relative to `origin/stage`" isn't the rule; CLAUDE.md rule 3 is **globally unique across the repo**, including unmerged branches. There's already one duplicate `110_*` in history that shouldn't be repeated. Both branches target stage, so whichever merges second breaks.

### Do

1. `git mv supabase/migrations/172_tenant_ai_enabled.sql supabase/migrations/174_tenant_ai_enabled.sql`
2. Update the `schema_migrations` self-record line **inside** the file — it names the filename literally (`VALUES ('172_tenant_ai_enabled.sql')` → `'174_...'`). The Migration Guard CI check requires this line to match.
3. Update the `-- Migration 172:` header comment.
4. **Clean the local ledger:** the local DB already recorded `'172_tenant_ai_enabled.sql'`. Delete that row so the local ledger doesn't carry a phantom version that will confuse the Phase 4 branch (which wants the real `172_ai_write_actions.sql` on this same machine). Then re-run `migrate-apply.sh local` and confirm `--dry-run` reports 0 pending.
5. Verify `174` is genuinely free: check `origin/stage`, `feature/ai-phase-4-writes`, **and** any other local branches.

---

## Out of scope — do not fix

The `/orca/*` nav surface you flagged is real but **not** a blocker, and I don't want it bundled here. I verified the only AI egress from Orca is `use-assistant-chat.ts:52` → `/api/v1/ai/chat`, which is gated — no other Orca component calls an AI endpoint. So a disabled tenant cannot reach OpenAI through Orca. What remains is UX (nav renders, Ask Orca reveals disabled state only after a failed send). It's queued separately.

---

## Gates

```bash
rm -rf .next && NODE_OPTIONS=--max-old-space-size=6144 npm run build
npx vitest run
npm run lint          # 0 errors; no new warnings over the 46 baseline
NODE_OPTIONS=--max-old-space-size=6144 npx tsc --noEmit
bash scripts/migrate-apply.sh local && bash scripts/migrate-apply.sh local --dry-run   # 0 pending
```

## Live verification (local)

1. **The one that matters:** with a tenant `ai_enabled=false`, run `npx tsx scripts/backfill-kb-ingestion.ts` against it with `AI_INGESTION_ENABLED=true`. Confirm **no** OpenAI call is made and no chunks are written. Show the evidence — Inngest dev stream at :8288 and the chunk count before/after. The claim is an absence, so demonstrate the absence.
2. Same script against an `ai_enabled=true` tenant → items ingest normally.
3. Re-run the two-tenant scenario from the original brief to confirm nothing regressed.
4. Confirm the renumbered migration applies cleanly and the local ledger has no `172_tenant_ai_enabled.sql` row remaining.

## Rules

- Stop at review. **No commit, no push, no PR.**
- Migration stays **local only** — not stage, not prod.
- If any finding is wrong on inspection, **say so and stop** rather than working around it.
