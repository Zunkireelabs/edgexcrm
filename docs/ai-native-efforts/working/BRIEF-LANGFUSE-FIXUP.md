# BRIEF — Langfuse masking fixup (Opus review findings)

**Branch:** stay on `feature/ai-langfuse-masking`. Work is uncommitted in the tree — expected. Do **not** commit, push, or open a PR.

The masking work is good: client-level hook via the verified SDK option, recursive through nested structures, numbers/booleans passing untouched, double-wrapped fail-closed, live-verified with `{"query": "[masked]", "limit": 5}` and real cost/duration data landing. All gates re-run and green (build 0, 232 tests, lint 0 errors/46 warnings, tsc 0), and `adapter.ts` confirmed untouched.

Two items. The first contradicts the design's own stated premise.

---

## Finding 1 — MUST FIX: `isIdLikeKey` unmasks the most sensitive fields in the product

The allow-list fails closed *except* for one escape hatch: any key ending in `id` passes unmasked. Running the actual predicate:

```
national_id     -> UNMASKED
passport_id     -> UNMASKED
citizenship_id  -> UNMASKED
studentId       -> UNMASKED
```

This is an education consultancy CRM handling student visa and admission data. **Passport and national ID numbers are the most sensitive PII in the system**, and the heuristic waves through exactly those keys. The code's own comment says a new tool argument "stays masked rather than leaking by default" — this is the one shape where it doesn't.

**Not currently live** — I checked: `custom_fields` reaches no AI tool payload today (`scoring-engine.ts` only counts keys). Latent, not leaking. Worth closing now while it costs three lines.

### Do

Gate on the **value shape**, not the key name. Every real record id in this system is a UUID, so:

- An id-like key passes unmasked **only if its value matches a UUID pattern**. Otherwise mask it.
- Add `displayid` to `SAFE_STRING_KEYS` so `ADM-001` survives for debugging — it's an internal reference, not personal data.

That inverts the failure mode correctly: `passport_id: "N1234567"` masks (not a UUID), `leadId: "eef51732-1fbf-485a-89fc-2777b9097985"` passes.

### Tests

- `national_id`, `passport_id`, `citizenship_id`, `studentId` with non-UUID values → **masked**. Name these fields explicitly in the test; they're the regression that matters and the test should say why.
- `leadId` / `tenantId` / `id` with UUID values → unmasked.
- An id-like key with a UUID-shaped value nested several levels deep → still unmasked.
- `display_id: "ADM-001"` → unmasked.

---

## Finding 2 — VERIFY (then fix if confirmed): trace tags may be overwritten

Every `end()` calls `trace.update({ output: data, tags })`, and each `Trace` object computes `tags` from **only its own data**. Multiple `Trace` objects share a single Langfuse trace id — `adapter.ts` creates one per tool call with the same `runId`, which is what makes the nesting work in the first place.

So the likely sequence is:

1. A tool errors → `trace.update({ tags: ["assistant", "tool-error:search_leads"] })`
2. Later, chat's `onFinish` → `trace.update({ tags: ["assistant"] })`

If Langfuse's trace upsert is last-write-wins on `tags`, **step 2 erases the tool-error tag** and the outcome metrics silently under-report exactly the failures they exist to surface. The unit tests can't catch this — they exercise one `Trace` in isolation, and the interaction only exists across objects sharing a trace id.

I could not settle server-side merge semantics from the type signatures alone. **Verify empirically before changing anything.**

### Do

1. Drive a real turn where a tool genuinely errors (a tool call against a nonexistent lead id is enough — no need to break a working code path). Then pull the finished trace back through the Langfuse API, the same way you verified the mask, and check whether `tool-error:*` survived on the final trace.
2. **If the tag was lost:** make tag writes additive rather than replacing — e.g. accumulate outcome tags per trace id, or only write tags that don't already exist on the trace. Whatever you choose, the constraint is that a tool-level outcome tag must survive a later trace-level update.
3. **If tags merge server-side and nothing is lost:** say so, change nothing, and add a comment recording that `trace.update` merges tags — so the next person doesn't "fix" a non-bug.

Either outcome is a good result. Report which one it is.

---

## Gates

```bash
rm -rf .next && NODE_OPTIONS=--max-old-space-size=6144 npm run build
npx vitest run          # baseline 232
npm run lint            # 0 errors; no new warnings over the 46 baseline
NODE_OPTIONS=--max-old-space-size=6144 npx tsc --noEmit
```

## Live verification

1. Re-run the masking check from last round — a chat turn searching a student by name, then pull the trace and confirm the name is still absent and ids/counts/durations still present. Finding 1 changes the mask logic, so the previously-verified behavior needs re-proving, not assuming.
2. The finding-2 tag check described above.

## Rules

- Stay on this branch. **No commit, no push, no PR.**
- Don't touch `adapter.ts` — it's modified on the Phase 4 branch and a conflict there is expensive.
- No migration.
- If either finding is wrong on inspection, **say so and stop.**
