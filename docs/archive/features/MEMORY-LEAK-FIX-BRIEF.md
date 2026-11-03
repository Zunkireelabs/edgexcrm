# MEMORY LEAK — PHASE B FIX BRIEF

**Status:** ready for Sonnet · **Author:** Opus session 2026-08-02 · **Branch to use:** `fix/memory-leak-phase-b` off latest `origin/stage`

Phase A (diagnosis) is COMPLETE. Root cause is identified, reproduced off prod, and there is a
hard pass/fail verification gate. This brief is the fix only.

---

## 1. What is happening

`leads-crm` (prod) OOM-crashes roughly hourly during Nepal business hours with:

```
FATAL ERROR: Ineffective mark-compacts near heap limit - JavaScript heap out of memory
[1:...] 45212456 ms: Mark-Compact 2001.2 (2081.8) -> 1985.0 (2078.3) MB
```

Docker restarts it in ~200 ms, so it self-heals in ~5 s — failed requests, not a sustained outage.
First confirmed crash 2026-08-02 05:56:25Z. Prod runs `mem_limit 3g` / `--max-old-space-size=2048`.

**Every authenticated dashboard page render permanently retains ~0.55 MiB of live heap.**

At that rate prod's observed ~2,240 MiB/h needs ~4,070 renders/hour — roughly 4.5 page renders
per minute across ~15 active counselors. Ordinary traffic. The app cannot survive a workday.

## 2. Root cause

Next.js 16.1.6's **instrumented global `fetch`** retains one request store per render. Retaining
path, walked from the GC root in a real heap snapshot (weak edges excluded):

```
global -> fetch -> closure -> _nextOriginalFetch -> Context -> Context
  -> WeakMap -> table -> (ephemeron entry)
  -> Promise -> <symbol kResourceStore> -> Object
  -> incrementalCache -> IncrementalCache
  -> requestHeaders -> { cookie: "sb-<ref>-auth-token=base64-..." }
```

Each render's AsyncLocalStorage request store — its `IncrementalCache`, its `requestHeaders`, and
the user's **full session cookie** — is entered into a WeakMap in the patched fetch's closure and
never released. The entry is immortal because the WeakMap's **value transitively references its own
key** (`Promise -> reactions_or_result -> the key Object`) — the self-sustaining ephemeron pattern.

### Evidence

| Check | Result |
|---|---|
| Retained per render (live heap) | **0.55 MiB**, survives forced full GC |
| `IncrementalCache` node count | 37 -> **239** across 200 renders (+202, exactly 1 per render) |
| Retainer itself | `_nextOriginalFetch` = 1, `kResourceStore` = 2 — singular, stable |
| Survives 17 min idle + 2 forced full GCs | t1 265,824,180 B vs t2 265,493,174 B (0.1% delta) |
| Control: `/login` (SSR, no Supabase fetches) | 0.042 MiB/req — **does not leak** |
| Control: `/api/v1/leads` (route handler) | 0.047 MiB/req — **does not leak** |
| Treatment: `/leads`, `/pipeline` (SSR dashboard) | 1.31 / 1.23 MiB/req raw anon |

`/login` is the clean discriminator: also server-rendered, but makes no Supabase fetches, and does
not leak.

### Ruled out during Phase A

- **The `/login` healthcheck.** Stage runs the byte-identical healthcheck with zero real traffic and
  grew 9.5 MiB/h vs prod's 167 MiB/h; 300 direct `/login` hits moved memory 0.042 MiB/req.
- **The undici keep-alive / global Agent** (`src/instrumentation.ts:15`, `keepAliveMaxTimeout:
  600_000`, no `connections` cap). Idle memory held **dead flat at 293 MiB for 13 minutes**, well
  past the 600 s horizon. Nothing was reclaimed.
- **Sentry.** No `NEXT_PUBLIC_SENTRY_DSN` is set on prod, stage, or the repro container, so
  `enabled: !!dsn` is false everywhere — yet the leak reproduces fully. (Not fully exonerated: the
  SDK still loads and wraps fetch when disabled. The fix below is robust to this either way.)
- **Uncollected garbage.** Heap snapshots force a full mark-compact and contain only live objects;
  the retained set is identical before and after 17 minutes of idle.

### Not established (do not assert it)

Why `/api/v1/leads` does **not** leak despite also calling Supabase. Most likely route handlers
don't instantiate an `IncrementalCache` the way RSC page renders do — consistent with
`IncrementalCache` being the retained object — but this was not verified.

---

## 3. This is a KNOWN upstream Next.js bug

Confirmed 2026-08-02. We are not the first to hit this, and the reports match our snapshot exactly
(`IncrementalCache` entries accumulating, heap permanently larger after GC):

- https://github.com/vercel/next.js/discussions/88603 — memory leak in **16.1.0**, OOM in Docker/K8s
- https://github.com/vercel/next.js/issues/90433 — OOM in 16.0.10 with `output: standalone` + fetch
- https://github.com/vercel/next.js/issues/85914 — Node 20/22/24 + fetch + standalone
- https://github.com/vercel/next.js/issues/64212 — leak in Next's global fetch specifically

It clusters on **Docker + `output: standalone` + fetch**, which is exactly our deployment:
`next.config` line 5 sets `output: "standalone"`, and the image runs **Node 22.23.2**. One reporter
sees OOM at 2 requests/second. The bug spans 16.0.1 -> 16.1.0 -> our 16.1.6.

**Before writing code:** check whether 16.1.7+ / 16.2.x has shipped a fix. If so, propose the version
bump instead and stop — a patch bump beats a workaround. Otherwise proceed to Option A.

## 4. Step 1 — the fix (try Option A first)

### Option A — `cacheMaxMemorySize: 0` — TESTED 2026-08-02, DOES NOT WORK. DO NOT RETRY.

The most-cited workaround in the threads above. Opus tested it directly on the throwaway container
by flipping `cacheMaxMemorySize` from `52428800` to `0` in the standalone runtime config and
restarting. Result, against an identical 200-render run:

| | baseline | `cacheMaxMemorySize: 0` |
|---|---|---|
| `IncrementalCache` count | 37 -> 239 | **37 -> 239** |
| snapshot size | 133 -> 265 MB | 139 -> 260 MB |

Byte-for-byte the same leak. Disabling the in-memory ISR/fetch LRU does not touch our variant,
because our retaining path runs through a **WeakMap in the patched-fetch closure**, not the LRU.
Recorded here so nobody spends a day rediscovering it.

### Option B — bypass the instrumented fetch — TESTED 2026-08-02, HALVES IT BUT DOES NOT FIX IT

Opus implemented this and ran it through the Section 5 gate locally (control build vs fixed build,
same 200-render load, stage DB, Next 16.1.6, `output: standalone`):

| | control | Option B (undici) |
|---|---|---|
| retained live heap / 200 renders | 86.7 MB | **39.5 MB** |
| RSS settled | 418.7 MB | **122.5 MB** |
| `IncrementalCache` **objects** retained | 5 -> 205 (**+200**) | 5 -> 205 (**+200**) |

It cuts retained heap ~54% (would stretch prod's crash interval from ~80 min to ~3 h) but **fails the
gate** — the per-render request-store retention is untouched.

**Why: there is more than one retainer.** With the fetch path bypassed, a heap trace on the fixed
build showed a second, independent one — Next's `cookies()` from `next/headers`, leaking via the
identical immortal-ephemeron pattern:

```
global -> ... -> moduleCache -> cookies (closure)
  -> WeakMap -> table -> (ephemeron) -> Promise -> JSProxy -> _parsed -> Map
  -> "sb-<ref>-auth-token=base64-..."
```

`cookies()` cannot be bypassed — it is how the app reads the session, called in the dashboard layout
and in `createClient()`. Chasing Next's request-scoped APIs one at a time is a losing game.

The undici change is worth keeping as a **mitigation** (halves the leak, no downside — we use none of
Next's fetch cache) but it is NOT the fix. Diff is uncommitted on Sadin's machine in
`src/lib/supabase/server.ts`.

#### Option B implementation (already written, uncommitted, keep as mitigation)

Route Supabase's HTTP through an **uninstrumented fetch** so its calls never create a WeakMap entry.
`undici` is already a direct dependency (imported in `src/instrumentation.ts:14`) and
`supabase-js` / `@supabase/ssr` both accept `global.fetch`.

**Files:**

- `src/lib/supabase/server.ts` — `createServiceClient()` (line ~55) and `createClient()` (line ~5)
- Anywhere else constructing a Supabase client server-side (grep for `createClient(` from
  `@supabase/supabase-js` and `createServerClient(` from `@supabase/ssr`)
- `src/lib/supabase/scoped.ts` inherits from `createServiceClient()` — no separate change expected,
  but verify.

**Shape:**

```ts
import { fetch as undiciFetch } from "undici";

// ...
return createClient(url, key, {
  global: { fetch: undiciFetch as unknown as typeof globalThis.fetch },
});
```

Notes:
- Keep the global dispatcher in `src/instrumentation.ts` as-is — `undici.fetch` uses it, so the
  keep-alive tuning from the round-trip work is preserved.
- A cast is expected: undici's `fetch` types don't structurally match the DOM `fetch` type.
- This bypasses Next's fetch cache. That is safe here: there is **zero** `unstable_cache`,
  `force-cache`, or `revalidate` usage in `src/` (verified), and Next 16 defaults to uncached.
- Trade-off accepted: Supabase calls lose Sentry fetch tracing. Sentry is currently inert (no DSN),
  so this costs nothing today.

### Option C — CHANGE THE NEXT.JS VERSION (THIS IS THE REAL FIX — do this)

Two independent Next 16.1.6 request-scoped APIs (`fetch`, `cookies()`) leak per-render state via the
same immortal-ephemeron pattern. That is not one workaround-able bug — it is a defect in how this
version manages request-scoped state, in the self-hosted `output: standalone` mode Vercel tests
least. Stop chasing individual APIs.

Order of attack, each validated with the Section 5 gate (`IncrementalCache` **objects** must stay
flat, not +200):

1. **Upgrade** to the newest 16.x and re-run the gate. Check the changelogs / the four linked issues
   first to see whether a fix actually landed; if none has, don't burn a build on hope.
2. If no 16.x passes, **downgrade to the latest `15.x`**. Every linked report starts at 16.0.1, so 15
   is plausibly unaffected — but **verify with the gate, do not assume**. Expect App Router API
   churn; budget for it. This is days of work against a known-good target, and is strongly preferred
   over living with hourly prod crashes.
3. Keep the Option B undici mitigation in place regardless — it halves the leak and costs nothing.

Report which versions were tested and their gate numbers, whatever the outcome.

## 5. Step 2 — VERIFICATION GATE (mandatory, not optional)

**Do not report this fixed on the basis of "memory looks better."** The gate is an object count.

A reproduction harness already exists on the Zunkiree VPS. `docker-compose.prod.yml` and stage's
compose file are **pristine and must stay that way** — the harness runs in a throwaway container.

1. Build the fixed image and start a throwaway container (pattern already proven):

   ```bash
   docker inspect leads-crm-dev --format '{{range .Config.Env}}{{println .}}{{end}}' \
     | grep -vE '^(NODE_OPTIONS|HOSTNAME)=' | grep -v '^$' > /tmp/leak.env
   echo 'NODE_OPTIONS=--max-old-space-size=768 --heapsnapshot-signal=SIGUSR2 --diagnostic-dir=/tmp' >> /tmp/leak.env
   docker run -d --name leads-crm-leak --network hosting --memory 1g \
     --env-file /tmp/leak.env <fixed-image>
   ```
   No Traefik labels — it must NOT be publicly routed.

2. Authenticate as a real user (the app rejects Bearer; it uses `@supabase/ssr` cookie auth):
   POST `{SUPABASE_URL}/auth/v1/token?grant_type=password` with `apikey` + `{email,password}`,
   then cookie value = `"base64-" + base64(JSON of the whole session response)`, cookie name
   `sb-<projectref>-auth-token`, split `.0`/`.1` at 3180 chars.
   Stage creds: `hello@admizz.org` / `edgexdev123`.

3. Warm up 5 renders, take a heap snapshot (t0), drive **200** `GET /leads`, wait 45 s, snapshot (t1).
   `docker kill -s SIGUSR2 <container>` writes to `/tmp/*.heapsnapshot`. The write **stops the world
   for >8 s** and the file appears at size 0 before it is flushed — poll until the size is non-zero
   **and** unchanged across two reads, or you will capture a truncated file.

4. **PASS/FAIL — count `IncrementalCache` nodes in t0 vs t1:**

   | | Before fix | Required after fix |
   |---|---|---|
   | `IncrementalCache` count | 5 -> 205 (**+200**) local · 37 -> 239 on VPS | **flat** (drift < ~10) |

   Anything close to +200 means the fix did not work, regardless of what the memory graph looks like.
   RSS and total heap are NOT the gate — Option B improved both substantially while still failing.

   ⚠️ **Count `object`-type nodes only.** A plain substring match on node names also catches strings
   like `"IncrementalCache: using custom cache handler"` and closures/code named `getIncrementalCache`,
   which inflates the number and can mislead. Filter on node type `object` with name
   `"IncrementalCache"`. (Gotcha in the helper scripts: parsed string values keep their surrounding
   double quotes, so compare against `"IncrementalCache"` **with** quotes or strip them first.)

Helper scripts from Phase A (streaming heapsnapshot parsers, low-memory, pure stdlib) are in this
session's scratchpad — `snapdiff.py` (aggregate + diff by constructor), `count.py` (count nodes by
name), `retain.py` (retaining path from GC root, weak edges excluded). Ask Sadin for them rather
than rewriting; a full `json.load` of a 265 MB snapshot will not fit comfortably in RAM.
`count.py` is already on the VPS at `/tmp/count.py`.

**Shortcut for config-only experiments (no rebuild):** in `output: standalone`, Next resolves the
config into `/app/.next/required-server-files.json` and reads it at runtime, so a config value can be
flipped there + `docker restart` to test the behaviour in ~30 s instead of a full CI build. This is
how Option A was disproved. It is a **TEST SHORTCUT ONLY** — the real change belongs in
`next.config` and must ship through the normal CI/GHCR build. Never do this to the prod or stage
containers.

5. Also confirm no regression: `npm run build` exit 0, `npm run test`, and
   `npx eslint --max-warnings 50`.

## 6. Gates / process

- Baseline: build exit 0 · eslint 45 warnings / 0 errors · tests 1,096 passing / 106 files.
- Branch from latest `origin/stage`; squash-merge to `stage`. **`stage` requires 1 human approval.**
- No migrations in this work.
- Vercel PR check is noise — judge CI on Lint / Type Check / Build / Test only.
- **STOP at review.** Do not merge, do not promote to `main`, do not touch prod. Report back with
  the before/after `IncrementalCache` counts and the gate output.

## 7. Out of scope

- The `/pipeline` 500-row card cap and PipelineBoard/list-kanban-board duplication —
  `docs/PIPELINE-CARDS-BRIEF.md`.
- The UTM widget's uncapped fetch.
- `lead-visibility.ts` unbounded `lead_branches` select.
- Raising the prod heap. It does not fix the leak, and 2048 -> 2560 would push anon past the 3 GiB
  `mem_limit`, converting a fast ~5 s V8 restart into a slower container OOM-kill. Both values would
  have to move together.

## 8. Phase B results — Option C tested and FAILED both directions (2026-08-02)

**Outcome: no Next.js version change closes the gate. Branch `fix/memory-leak-phase-b` ships
only the Option B undici mitigation (already-reviewed diff, kept as-is); the root leak is
unresolved and open.**

### What was tested

| Version | Direction | Gate: `IncrementalCache` (object-type nodes, t0 → t1) | Result |
|---|---|---|---|
| 16.1.6 (current) | baseline | 5 → 205 (+200) | reference, from §4 |
| **16.2.12** (newest stable 16.x) | upgrade | **5 → 205 (+200)** | **FAIL** |
| **15.5.22** (newest stable 15.x) | downgrade | **5 → 205 (+200)** | **FAIL** |

Both alternate versions reproduce the identical +200 pattern, byte-for-byte the same shape as
the documented 16.1.6 baseline. Neither newest-16.x nor latest-15.x closes the gate. The "every
report starts at 16.0.1, 15 is plausibly unaffected" hypothesis in §4 Option C step 2 is **wrong**
— verified, not assumed, per the gate.

### 16.x: checked before building (per §3 instruction)

Before burning a build, checked the four linked issues/discussions for a landed fix:

- `vercel/next.js#88577` (merged 2026-02-10, shipped in 16.2.0+) fixes a *different* leak surface
  — `ReadableStream` tee'd-branch cleanup in `cloneResponse` + Turbopack `RuntimeStyles` — not the
  `IncrementalCache`/`cookies()` WeakMap ephemeron pattern this repro hits.
- Discussion `#88603` is still open; issue `#90433` was closed by a Next maintainer disputing
  reproduction, but a reporter (`haoyanwang`) explicitly re-tested on `16.2.0-canary.51` and
  `.70` and the leak persisted both times — the closure is disputed, not resolved.
- No fix for this specific pattern was confirmed landed anywhere up to `16.2.12`.

That evidence predicted a 16.x upgrade wouldn't help. Built and gate-tested it anyway (cheap once
the local harness was working) for a complete, gate-verified report rather than resting on
GitHub-thread inference alone. Confirmed: **FAIL**, exactly as the threads suggested.

### 15.x: verified, not assumed

15.5.22 was gate-tested directly rather than trusting "every report starts at 16.0.1." Also
**FAIL**, +200 — meaning the WeakMap ephemeron retention pattern (or something that reproduces
identically) already exists in 15.x, or was introduced earlier than the linked reports suggest, or
is triggered by something in this app's/`@supabase/ssr`'s interaction with `cookies()`/fetch that
isn't specific to the Next 16.x releases at all. Not established which — out of scope for this
branch to chase further; see "Escalation" below.

The 15.x downgrade also required real tooling churn (budgeted for per §4 Option C step 2, but
worth recording since none of it survived — the branch reverted cleanly back to 16.1.6):

- `eslint-config-next@15.5.22` dropped the flat-config exports 16.x shipped
  (`eslint-config-next/core-web-vitals` as an ES module) — 15.x only ships legacy eslintrc-format
  configs, requiring `FlatCompat` from `@eslint/eslintrc` to bridge into the repo's ESLint 9 flat
  config.
- `eslint-plugin-react-hooks` dropped from 7.x (16.x) to 5.2.0 (15.x's `eslint-config-next` pin),
  which doesn't define the `react-hooks/set-state-in-effect` rule at all — the 11
  `// eslint-disable-next-line react-hooks/set-state-in-effect` comments in `src/` became
  "Definition for rule ... was not found" errors and had to be stripped for the 15.x lint pass to
  run. (All 11 were restored verbatim on revert to 16.1.6 — see below.)
- `npm run build` / lint / typecheck / test all passed clean on 15.5.22 otherwise (App Router APIs
  themselves had zero churn — `cookies()`/`headers()` async signatures, `params`/`searchParams` as
  promises, and the `src/middleware.ts` filename were already 15.x-shaped since this app never
  adopted 16-only APIs).

### A harness bug found and fixed along the way (not a product bug)

The local heap-snapshot harness inherited from Phase A silently failed on the first two attempts:
`GET /leads` returned `307` to `/login` instead of rendering, because `npm run build` was picking
up the repo's auto-loaded `.env.local` (points at the **local** Docker Supabase project,
`127.0.0.1:54321`) instead of `.env.stage.local` (the stage project the test cookie was minted
against) — `NEXT_PUBLIC_SUPABASE_URL` is inlined at **build** time, not read at runtime, so sourcing
`.env.stage.local` only before starting `node server.js` (and not before `npm run build`) baked in
the wrong project ref. Once `.env.stage.local` was sourced before the build too, auth worked and
warmup returned `200` as expected. Also found and fixed a second, independent bug: the mint script
(`mint.py` in the Phase A scratchpad) encoded the session cookie with standard base64
(`base64.b64encode`), but `@supabase/ssr`'s cookie decoder (`stringFromBase64URL`) only accepts the
base64url alphabet (`A-Za-z0-9-_`) and throws on `+`/`/` — a synthetic cookie could accidentally
"work" or "fail" depending on whether that request's session JSON happened to base64-encode to a
string containing `+` or `/`. Fixed by minting with `base64.urlsafe_b64encode` instead
(`mint_urlsafe.py`, scratchpad). Neither of these affects real users (real login always goes through
`@supabase/ssr`'s own base64url-encoding `setItem`) — they were harness-only bugs.

**Also found and fixed:** the gate-counting script (`count.py`) inherited from Phase A does **not**
implement the two filters the brief's own §5 step 4 ⚠️ warns about — it does a raw substring match
over all node names (not restricted to `type: "object"` nodes) and matches without requiring the
surrounding quotes. A corrected script (`count_strict.py`, scratchpad) filters to
`node_types[type_idx] == "object"` and requires an exact `"IncrementalCache"` (quoted) match before
counting. Recommend `count_strict.py` supersede `count.py` for any future gate run — the numbers in
this section were produced with the strict version. (The unfiltered `count.py` happened to produce
numbers in the same ballpark on this codebase — 44→246 vs the strict 5→205 — so it wasn't
masking the verdict here, but per the brief's own warning it should not be trusted blind.)

### Branch state

`fix/memory-leak-phase-b` carries exactly one functional change: the Option B undici-fetch
mitigation in `src/lib/supabase/server.ts` (same diff described in §4 Option B, unmodified). The
Next.js version is unchanged at `16.1.6`. All attempted version bumps (16.2.12, 15.5.22) and their
associated tooling churn were fully reverted — `package.json`, `package-lock.json`,
`eslint.config.mjs`, and the 11 `react-hooks/set-state-in-effect` disable comments all match
`origin/stage` byte-for-byte except for the one intended `server.ts` diff. Regression gates on the
final state: build exit 0, `npx eslint --max-warnings 50` → 0 errors / 45 warnings (baseline),
`tsc --noEmit` clean, `npm run test` → 1,096/1,096 passing across 106 files (baseline). Confirmed
via `git diff origin/stage` that no unintended file differs.

### What this branch does NOT do

- Does not close the mandatory gate. `IncrementalCache` still goes 5→205 (+200) on this branch,
  same as unpatched 16.1.6 — Option B alone was already known to fail the gate (§4), and no version
  change fixes it either.
- Does not merge, does not touch stage or prod, per the STOP AT REVIEW constraint.

### Escalation — every Opus-authorized option in this brief is now exhausted

Option A, Option B alone, Option C-upgrade, and Option C-downgrade have all been tried and gate-
verified FAIL. What's left is out of this brief's scope and needs a design decision before more
work is spent:

1. **File the exact repro upstream** (a minimal reproduction matching this app's `cookies()` +
   `fetch` + `output: standalone` + Docker shape) against `vercel/next.js#88603` — it's still open,
   and none of the current comments include a snapshot-verified `IncrementalCache` object count
   the way this repro has one.
2. **Investigate whether this is actually a `@supabase/ssr` interaction, not a pure Next.js bug** —
   both leak-surface owners identified in Phase A (`fetch`, `cookies()`) are exercised specifically
   by `@supabase/ssr`'s `createServerClient` on every authenticated render; a repro that swaps in a
   bare `cookies()` call with no Supabase client involved was not attempted and would isolate this.
3. **A restart-based mitigation** (e.g., a scheduled/health-triggered container restart before the
   ~80 min crash-interval-with-Option-B-mitigation) is not a fix but would convert unplanned OOM
   crashes into planned brief ones — a possible stop-gap if upstream/root-cause work is going to
   take longer than the current hourly-crash pain is worth. Not evaluated for safety
   (in-flight-request impact) — flagging as a candidate for the next brief, not proposing it here.

## 9. Cleanup owed when done

- `docker rm -f leads-crm-leak` on the VPS.
- Remove `/tmp/{t0,t1,t2}.snap` (~660 MB) and `/tmp/leak.env` from the VPS.
- Stage container carries ~380 MiB of leak from Phase A load testing; a restart clears it.
