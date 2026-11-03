# BRIEF — Phase 4E: id resolution + actionable tool errors

**Branch:** stay on `feature/ai-phase-4-writes` (now `9b369eb`, clean tree). Do **not** commit, push, or open a PR.

## The pattern

Live testing surfaced three failures that look unrelated and share one root cause: **the tools demand ids the model has no way to obtain, and when it gets input wrong it isn't told why — so it guesses, fails silently, and retries blind until the step budget is gone.**

Every one of these failed *safely* — nothing was written, and the 4D approval card correctly showed NOT FOUND for the fabricated ids. These are usability defects, not safety defects. But an assistant that burns six steps and fabricates UUIDs is not shippable, and the "model just needs a better prompt" reading is wrong: in two of three cases the information the model needed was **not obtainable through any tool**.

Fix all four items in one pass — they're the same seam.

---

## Item 1 — `update_lead_stage` rejects valid input

`src/lib/ai/tools/universal/update-lead-stage.ts:23` requires *exactly* one of `stageName` / `stageId`:

```ts
.refine((v) => Boolean(v.stageName) !== Boolean(v.stageId), { message: "Provide exactly one of stageName or stageId." })
```

After calling `pipeline_summary` the model has both a name and an id, so supplying both is the natural thing to do — and gets rejected before `execute()` ever runs.

But the implementation at lines 60-62 **already handles both**:

```ts
if (input.stageId) { matched = ... } else if (input.stageName) { ... }
```

`stageId` takes precedence. The refine is stricter than the code requires and buys nothing.

### Do

Relax to **at least one** of `stageName`/`stageId` (both absent is still an error). Update both field descriptions and the tool description (line ~49) to state that supplying both is fine and `stageId` wins. Add a test for the both-supplied case asserting `stageId` is used.

---

## Item 2 — tool input validation failures are invisible to the model (the class fix)

This is the item that matters most; items 1, 3 and 4 are instances of what it protects against.

Zod input validation runs **inside the AI SDK, before `execute()`** — so `adapter.ts`'s error wrapper (lines 37-40), which turns thrown errors into model-visible `{ error }` payloads, never sees it. The failure instead reaches the chat route's stream handler (`route.ts:234-236`) and becomes:

> "Something went wrong generating a response. Please try again."

The model gets no indication of *what* was wrong, so it cannot self-correct. Observed live: four retries, fabricated stage UUIDs, entire 6-step budget consumed, no approval card ever shown.

### Do

**First, diagnose the actual path.** Determine precisely how a zod input-validation failure propagates in `ai@7.0.29` — whether it reaches `onError`, whether the SDK offers a repair/`experimental_repairToolCall` hook, and whether the model sees anything at all. **Report what you find before implementing.** If my description above is wrong, say so and stop.

Then make validation failures **model-visible and actionable**: the model should receive the zod message (e.g. *"Provide exactly one of stageName or stageId"*) as a tool-error result it can act on, and retry with corrected input.

⚠️ **Do not widen `onError` to return raw error text.** That handler's comment is right — it must never leak raw provider error details to the client. The fix is to make *tool input validation* a distinct, sanitized, model-visible path, not to loosen the generic stream-error handler. Keep the user-facing generic message for genuine provider/stream failures.

Cap retries so a model that can't self-correct fails fast with a clear message instead of consuming the step budget.

---

## Item 3 — no way to look up a knowledge base

`create_knowledge_item`'s `knowledgeBaseId` description says *"ask the user which knowledge base if you don't already know it; never invent one."* **There is no tool that lists knowledge bases.** `search_knowledge` reads KB names internally (`search-knowledge.ts:46`) but never exposes them; `create_knowledge_item`'s error message lists them (line ~70) but only *after* a failed call.

So the model is instructed not to invent an id while having no way to obtain one. It invented one — twice, in two separate sessions, reproducibly.

### Do

Add a `list_knowledge_bases` read tool (`scope: "read"`) returning each accessible KB's `id` and `name`, tenant-scoped via the normal `db`. Reference it from `create_knowledge_item`'s description ("use `list_knowledge_bases` first to get the id") and add a line to the system prompt's tool-use guidance, matching how `search_leads`/`team_lookup` are already called out for lead actions.

---

## Item 4 — `search_leads` can't match a display id

`search-leads.ts:100-101` matches on `first_name`, `last_name`, `email`, `phone` — **not `display_id`**. So searching `"ADM-009"` returns nothing, and when a user references a lead the way staff actually do, the model can't resolve it and fabricates a UUID. Observed during 4C testing; this is queue item 7.

### Do

Include `display_id` in the search. A token that looks like a display id (e.g. `/^[A-Z]{2,5}-\d+$/i`) should match `display_id` directly — ideally short-circuiting to an exact match, since that's an unambiguous identifier and should not compete with fuzzy name hits.

Note the existing `.or()` semantics comment at lines 95-96: chained `.or()` calls AND together in PostgREST, so each token must match somewhere. Don't break multi-token name search while adding this.

---

## Tests

- `update_lead_stage` with both `stageName` and `stageId` → succeeds, uses `stageId`.
- `update_lead_stage` with neither → still a clear validation error.
- A tool input validation failure produces a **model-visible, actionable** error containing the zod message — not the generic stream message. This is the regression test for item 2; write it even if the fix lands elsewhere.
- `list_knowledge_bases` returns only the caller's tenant's KBs.
- `search_leads("ADM-009")` returns exactly that lead; `search_leads("Manisha")` still works; multi-token name search still works.

## Gates

```bash
rm -rf .next && NODE_OPTIONS=--max-old-space-size=6144 npm run build
npx vitest run          # baseline 449
npm run lint            # 0 errors; no new warnings over the 46 baseline
NODE_OPTIONS=--max-old-space-size=6144 npx tsc --noEmit
```

## Live verification (local, `admizz-local`)

The bar is the two flows that failed. Both must now complete **without fabricated ids and without exhausting the step budget**:

1. *"move Riya Sharma to Qualified"* → approval card appears on the first attempt. Then *"undo that"* → the undo card shows a **sentence** describing the stage change (this was never verified — it was blocked by item 1).
2. *"save a note to the Sales SOPs knowledge base saying …"* → the model calls `list_knowledge_bases`, gets the real id, and the card names the KB. Approve → item saved with the AI-written badge → ask a question that retrieves it → cited as "(AI-written)". That completes the fresh save→retrieve loop that's still unverified.
3. *"add a note to ADM-009"* → resolves via `search_leads` without a fabricated UUID.

## Rules

- Stop at review. **No commit, no push, no PR.**
- No migration — this is tools + prompt + error plumbing.
- If any finding here is wrong on inspection, **say so and stop** rather than working around it. Item 2's mechanism especially: diagnose before you implement.
