# BRIEF — Per-tenant `ai_enabled` + explicit provider pin (ADR-001 D5 gate)

**Branch:** cut a fresh one from the latest `origin/stage`:
`git fetch origin && git switch -c feature/ai-per-tenant-flag origin/stage`

⚠️ **Do NOT build this on `feature/ai-phase-4-writes`.** That branch holds unmerged Phase 4 work and a local-only migration (173). This is independent and must be reviewable on its own.

**Why this exists:** ADR-001 Decision 5 requires AI rollout in a fixed order — Zunkiree Labs → Mobilise → **Admizz last, and only after written client consent** (Admizz is data controller for student PII; EdgeX is processor). That gate is currently **unenforceable**: the only switches are the environment-level flags in `src/lib/ai/flag.ts`. Flipping `AI_ASSISTANT_ENABLED=true` on prod enables the assistant for *every* prod tenant simultaneously, Admizz included. This brief builds the control the consent paperwork will describe.

---

## Part 1 — `tenants.ai_enabled`

### Migration

Next free number (run `ls supabase/migrations/ | sort` and take it — **do not assume 174**; verify nothing else has landed on stage).

- `ALTER TABLE public.tenants ADD COLUMN IF NOT EXISTS ai_enabled boolean NOT NULL DEFAULT false;`
- Additive, transactional, `IF NOT EXISTS`, with the `schema_migrations` self-record line (required by the Migration Guard for any migration ≥123 — copy the pattern from `173_ai_write_provenance.sql`).
- Header comment: before/after row counts, rollback line, `Applied: <env>` line.

**`DEFAULT false` is deliberate and load-bearing.** Every existing tenant lands opted-*out*. Turning AI on becomes an explicit per-tenant act, which is exactly what a consent gate means. Do not default to true, and do not backfill any tenant to true — including Zunkiree's own.

### Gating rule

**Both** conditions required: env flag on **AND** `tenants.ai_enabled` true. The env flag stays as the environment-wide kill switch; the column is the per-tenant grant. Neither alone is sufficient.

### Where to gate

`auth.tenantId` is already on `AuthContext`, so the tenant lookup is available at every call site.

Assistant (all currently call `isAssistantEnabled()` and `return apiNotFound()` on false — keep that exact response so a disabled tenant is indistinguishable from a nonexistent route):
- `src/app/(main)/api/v1/ai/chat/route.ts:55`
- `src/app/(main)/api/v1/ai/conversations/route.ts:15`
- `src/app/(main)/api/v1/ai/conversations/[id]/route.ts:24`
- Sweep for any other `isAssistantEnabled()` call site — the list above is what exists today, confirm it's still complete.

Ingestion (currently `const ingestionEnabled = isIngestionEnabled()`):
- `src/app/(main)/api/v1/knowledge-bases/[id]/items/route.ts:85`
- `src/app/(main)/api/v1/knowledge-bases/[id]/items/[itemId]/route.ts:83`

⚠️ **The ingestion sites are the ones that matter most for D5** — that's the path that ships document text to a third-party embeddings API. A disabled tenant must land items at `status: 'ready'` with **no Inngest event**, exactly as the env flag off-path does today.

UI: the assistant mounts via `AIAssistantProvider` at `src/app/(main)/(dashboard)/layout.tsx:105`. The layout is a Server Component that already fetches the tenant — gate the provider (or its rendered entry point) on the same combined condition so a disabled tenant sees no assistant UI at all, not a UI whose requests 404.

Prefer **one shared helper** (e.g. `isAssistantEnabledForTenant(tenantId)` / `isIngestionEnabledForTenant(tenantId)`) over repeating the two-part check at seven call sites. One truth function, same as `getFeatureAccess`.

Watch the query cost: the chat route is hot. If the tenant row isn't already loaded on that path, select just `ai_enabled` — don't pull the whole tenant.

---

## Part 2 — pin the provider explicitly

`src/lib/ai/models.ts:7` currently derives the active provider from whether an env var happens to exist:

```ts
export const ACTIVE_PROVIDER: "openai" | "anthropic" = process.env.ANTHROPIC_API_KEY ? "anthropic" : "openai";
```

This means **the set of third parties receiving customer data changes silently based on deployment config.** Someone adds `ANTHROPIC_API_KEY` to prod and generation + OCR migrate to a different vendor with no code review, no deploy signal, and no notice to a client whose signed consent names the old one. Sadin has confirmed prod stays on OpenAI for now with a possible provider move later — which makes this worse, not better: the move must be a deliberate, reviewable act.

### Do

- Add `AI_PROVIDER` (`"openai" | "anthropic"`), read explicitly. **Default to `"openai"`** — matches prod today.
- An unset `AI_PROVIDER` must resolve to the documented default, not to key-presence sniffing. Presence of `ANTHROPIC_API_KEY` must no longer change provider selection on its own.
- If `AI_PROVIDER` names a provider whose API key is missing, **fail loudly at startup or first use** with a clear message. Do not silently fall back to the other vendor — a silent fallback is precisely the disclosure hazard being removed.
- Update the `models.ts:1` comment ("Provider swap = set ANTHROPIC_API_KEY") — it will be wrong.
- Add a short comment noting that changing `AI_PROVIDER` changes the disclosed sub-processor set and requires a privacy-disclosure update.

---

## Tests (this is the D5 evidence trail — be thorough)

- `ai_enabled` false + env flag on → assistant routes 404; ingestion lands `status: 'ready'` with **no Inngest event**.
- `ai_enabled` true + env flag **off** → still disabled. Prove the env kill switch still wins.
- Both on → normal behavior, unchanged from today.
- Default: a tenant row created without specifying `ai_enabled` reads `false`.
- Provider resolution: unset `AI_PROVIDER` → `"openai"`; `AI_PROVIDER=anthropic` with `ANTHROPIC_API_KEY` present → anthropic; `AI_PROVIDER=anthropic` with the key **absent** → loud failure, not an OpenAI fallback.

## Gates

```bash
rm -rf .next && NODE_OPTIONS=--max-old-space-size=6144 npm run build
npx vitest run
npm run lint          # 0 errors; do not add warnings
NODE_OPTIONS=--max-old-space-size=6144 npx tsc --noEmit
bash scripts/migrate-apply.sh local && bash scripts/migrate-apply.sh local --dry-run   # second run: 0 pending
```

## Live verification (local, `admizz-local`)

1. With `ai_enabled=false`: assistant UI absent from the dashboard; `POST /api/v1/ai/chat` 404s; adding a KB item leaves it `ready` with no ingest event fired (check the Inngest dev UI at :8288 — **absence of an event is the claim, so show the empty stream**).
2. Flip that tenant to `true`: assistant appears, chat responds, KB item ingests and becomes searchable.
3. With `ai_enabled=true` but `AI_ASSISTANT_ENABLED` unset: assistant gone again.
4. **Two tenants at once** — this is the actual D5 scenario. Enable one local tenant, leave a second disabled, confirm the disabled one has no assistant while the enabled one works. A single-tenant test does not demonstrate per-tenant gating.

## Rules

- Stop at review. **No commit, no push, no PR** — Opus reviews first.
- Migration is **local only**. Do not apply to stage or prod.
- Do not flip `ai_enabled` to true for any tenant in a migration or seed on stage/prod. Local seed is fine.
- If any part of this brief turns out to be wrong on inspection, **say so and stop** rather than working around it.
