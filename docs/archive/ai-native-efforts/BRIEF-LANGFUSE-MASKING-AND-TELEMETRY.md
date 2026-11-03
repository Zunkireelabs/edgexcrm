# BRIEF — Langfuse PII masking + product telemetry

**Branch:** cut fresh from the latest `origin/stage`:
`git fetch origin && git switch -c feature/ai-langfuse-masking origin/stage`

⚠️ **Do not build on `feature/ai-phase-4-writes` or `feature/ai-per-tenant-flag`** — both hold unmerged work and local-only migrations. This must be reviewable on its own.

⚠️ **`src/lib/ai/tools/adapter.ts` is modified on the Phase 4 branch.** Avoid touching it if you can (part 1 shouldn't need to). If part 2 genuinely requires changes there, **say so and stop** — we'll decide how to sequence it rather than create a third merge conflict.

## Why

Two goals, one file mostly.

**Privacy.** ADR-001 D5 and `05-CROSS-CUTTING-PLATFORM.md` both state "PII masking ON at the SDK level" for Langfuse. **It was never implemented.** `src/lib/ai/telemetry.ts:21-25` constructs the client with keys and `baseUrl` only. Tool-call arguments reach Langfuse Cloud unmasked via `adapter.ts:26` (`trace.span(\`tool:${id}\`, { input })`), and those arguments can carry personal data — a student's name in a `search_leads` query, note text in `create_lead_note`, a title in `create_knowledge_item`. This is the last open data-egress gap in the AI stack; every other boundary (cross-tenant, within-tenant permissions, consent-gated ingestion, provider drift) is closed.

**Product understanding.** Sadin wants full visibility into how the assistant is actually used — usage, cost, latency, which tools fire, where it fails. Today's telemetry is thin: point-in-time events with no durations, and token counts only on the chat surface.

**These do not conflict.** Mask the *values* inside payloads; keep every operational field. Knowing `search_leads` ran in 340 ms and returned 3 rows is the signal. Knowing it searched for "Manisha Rai" is the liability. Nothing analytically useful is lost.

---

## Part 1 — Masking (the privacy fix; do this first and completely)

The installed `langfuse@3.38.20` supports a client-level mask — verified in `node_modules/langfuse-core/lib/index.d.ts`:

```ts
mask?: MaskFunction            // line 6966
type MaskFunction = (params: { data: any }) => any;   // line 7126
```

It is applied via `maskEventBodyInPlace` (line 7407), i.e. **to every event body the client sends**.

### Do

Pass a `mask` function when constructing the client in `telemetry.ts`. **Client-level, not per call site** — this is the same principle as the `kb-ingest` egress gate: one check every path converges on, so a new `trace.span()` caller added next month is covered automatically. Per-call-site masking would be re-opening the hole by design.

**Mask** — free-text and identifier-shaped *values*: strings that look like emails, phone numbers, or person names; the values of keys like `content`, `query`, `title`, `note`, `description`, `first_name`, `last_name`, `email`, `phone`, `name`.

**Keep** — everything operational: UUIDs and record ids (they're opaque and needed to correlate), tool names, model ids, token counts, costs, durations, booleans, enums, statuses, error types, step counts, `tenantId`, `userId`, `industryId`, `surface`.

Prefer an **allow-list of safe keys** over a deny-list of unsafe ones where practical. A deny-list fails open — a new tool with a `studentRemarks` field leaks until someone remembers to add it. An allow-list fails closed.

**Fail closed.** If the mask function throws, drop the payload entirely rather than sending it unmasked. Wrap the body in a try/catch and return a placeholder like `"[mask error]"`. A masking bug must never degrade into an unmasked send.

### Tests

- A tool input containing a name, email and phone → all three absent from the masked output; the tool name, ids and counts still present.
- A nested/deep object is masked at every level, not just the top.
- A mask function that throws → the payload becomes a placeholder, and nothing unmasked is emitted. **This is the one that matters most.**
- Masking is active whenever the client is constructed — a test that would catch someone constructing it without the option.

---

## Part 2 — Telemetry (the product-understanding work)

Current gaps in `telemetry.ts`: `span()` emits `trace.event()` (a point in time, no duration), so **there is no per-tool latency**; token counts exist only on the chat surface; and Langfuse's cost calculation isn't wired.

### Do

1. **Real spans with durations.** Give `Trace` a way to open a span and close it, so each tool call records a duration. Keep the existing `span()`/`end()` signatures working — `route.ts`, `adapter.ts`, `kb-ingest.ts` and `retrieve.ts` all call them, and this brief should not require touching those call sites (see the adapter warning above).
2. **Cost.** Langfuse derives cost from model id + token usage. Ensure the model id and usage are attached to the generation so cost lands per run and aggregates per tenant. `gpt-4o-mini` is a recognised model.
3. **Tool-sequence visibility.** Tool spans should nest under the run's trace so a run reads as an ordered sequence rather than loose events.
4. **Outcome metrics worth having** — surface these as trace tags/attributes so they're filterable:
   - **step-budget exhaustion** (a run that hits `MAX_TOOL_STEPS` without answering — this is exactly the failure that hid the 4E bugs for weeks)
   - **write-tool outcomes**: proposed / approved / denied / failed (`ai_write_actions.status` already records this)
   - **degraded retrieval** (`retrieve.ts` already computes `degraded` — make it filterable)
   - **tool error rate** per tool id
5. Do **not** duplicate what `ai_usage_events` already stores. If a metric belongs in the DB rather than Langfuse, say so.

### Tests

Cover the seam, not the vendor: a span records a duration; usage/model reach the generation; the outcome tags are set for each case. Don't test Langfuse itself.

---

## Gates

```bash
rm -rf .next && NODE_OPTIONS=--max-old-space-size=6144 npm run build
npx vitest run          # report the baseline on this branch before you start, and the delta after
npm run lint            # 0 errors; no new warnings over the 46 baseline
NODE_OPTIONS=--max-old-space-size=6144 npx tsc --noEmit
```

## Live verification (local, `admizz-local`)

Langfuse keys are already in `.env.local`, so traces land in the real project.

1. Drive a chat turn that calls `search_leads` **with a student's name** ("find Manisha Rai"). Then open that trace in Langfuse and confirm: the tool call is recorded, the name is **not** anywhere in the payload, and the tool name / ids / counts / duration are. **Quote what the payload actually shows** — this is the claim that matters and it's an absence, so show it.
2. Confirm token counts and a computed cost appear on the run.
3. Confirm the run reads as an ordered tool sequence with per-tool durations.
4. Trigger a degraded retrieval or a tool error and confirm it's filterable.

## Rules

- Stop at review. **No commit, no push, no PR.**
- No migration expected. If you think one is needed, say so and stop — and check the next free number across **all** branches (172, 173, 174 are taken on unmerged branches).
- Part 1 is the priority. If part 2 turns out to be much larger than it looks, land part 1 cleanly and report rather than half-doing both.
- If anything here is wrong on inspection, **say so and stop** — that instruction has now caught two bad briefs of mine.
