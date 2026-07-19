# BRIEF — Phase 4F: drop `actionId` from `undo_lead_action`

**Branch:** stay on `feature/ai-phase-4-writes` (`9b369eb`). The 4E work + seed fix are uncommitted in the tree — expected, leave them. Do **not** commit, push, or open a PR.

## The problem

`undo-lead-action.ts:11-13` describes `actionId` as coming *"from a prior tool result's undoOf/action reference."* **No tool result contains such a reference.** `update_lead_stage` returns `{ leadId, stage, previous, note }`; `assign_lead` is equivalent. There is no path by which the model can learn a real `ai_write_actions.id`.

So the schema offers a field the model cannot fill correctly, and points it at a source that doesn't exist. Observed live across three consecutive runs: the model fabricates a UUID every time rather than omitting the field, and the 4D approval card shows `Action: NOT FOUND (<fabricated-id>)`. The undo has never once executed.

Fixing this by exposing the id is architecturally blocked: `execute()` runs **before** the `ai_write_actions` insert, so the row's id doesn't exist when the tool returns — the same ordering documented in migration 173's header, and the reason 4C keyed provenance on `tool_call_id` rather than a FK.

**Decision (Sadin, 2026-07-19): remove `actionId`.** Undo always targets the caller's most recent undoable action. Same shape as 4E item 1 — delete the constraint that buys nothing, rather than teach the model to work around it. The omit path already exists and works; "undo that" essentially always means the last thing. Targeting an older action stays available in the UI.

---

## Do

### 1. `src/lib/ai/tools/universal/undo-lead-action.ts`

- Remove `actionId` from `inputSchema`. The schema becomes an empty object (`z.object({})`) — confirm the AI SDK and the adapter handle a no-parameter tool cleanly; if they don't, say so and stop rather than working around it.
- Remove the by-id lookup branch in `execute()`. The "most recent undoable action for this user" query becomes the only path.
- Update the tool description: it currently offers *"or a specific one by its action id"* — that capability is going away. State plainly that it undoes the caller's most recent `update_lead_stage` or `assign_lead`.
- Keep every governance rule intact — the revert-rules refusal, the `user_id` ownership check, `UNDOABLE_TOOL_IDS`. **None of that changes.** This removes an input field, not a safety check.

### 2. `src/app/(main)/api/v1/ai/resolve-approval-refs/route.ts` (4D)

`resolveUndoAction` has a by-id branch that becomes unreachable once the tool can't accept an id. Remove it and keep the most-recent path (which already filters on `user_id` and `status`/`tool_id`).

⚠️ Keep the `undo_action` **ref kind** itself — the card still needs to render the sentence, it just always describes the most-recent action now. `EntityRef.id` for that kind will always be `null`; simplify accordingly rather than leaving a dead parameter threaded through.

### 3. Prompt

Check `assistant.ts` for any wording implying undo can target a specific action. Adjust if present.

## Tests

- `undo_lead_action` with no input undoes the caller's most recent undoable action.
- A user with no undoable actions gets the existing clean "nothing to undo" style error, not a crash.
- Ownership still enforced: it never targets another user's action (the most-recent query's `user_id` filter).
- Governance still enforced: a revert-rules refusal still surfaces as a plain refusal.
- The 4D resolver renders the undo **sentence** for the most-recent action.
- Remove/replace the by-id tests in both files rather than leaving them asserting removed behavior.

## Gates

```bash
rm -rf .next && NODE_OPTIONS=--max-old-space-size=6144 npm run build
npx vitest run          # baseline 459 — expect a net change as by-id tests are removed; report the delta and why
npm run lint            # 0 errors; no new warnings over the 46 baseline
NODE_OPTIONS=--max-old-space-size=6144 npx tsc --noEmit
```

## Live verification — this is the point of 4F

The undo-sentence rendering has **never been seen working by anyone**, across 4D, 4E, and the seed fix. It is the last unproven piece of the whole write surface.

1. *"move Riya Sharma to Qualified"* → approval card → approve → succeeds.
2. *"undo that"* → the approval card must show a **sentence**: `Undo: stage change on Riya Sharma (ADM-001), Pre-qualified → Qualified, N minutes ago` — no `NOT FOUND`, no UUID.
3. Approve it → the lead returns to Pre-qualified. Confirm in the DB, and confirm `ai_write_actions` records the undo with `undo_of` set.
4. Ask to undo again immediately → should behave sanely (either refuses or undoes the next undoable action) rather than crashing or looping.

Report step 2's card text verbatim. If a browser/screenshot tool still isn't available, say so plainly as before — don't substitute silently.

## Out of scope — leave queued

The latent `apply-lead-patch` NOT NULL bug when a list genuinely lacks a pipeline; the pending-approval stream crash (`AI_MissingToolResultsError`); `optionalUuid` not stripping the all-`f` sentinel.

## Rules

- Stop at review. **No commit, no push, no PR.**
- No migration.
- If any part of this is wrong on inspection, **say so and stop** — that instruction has now caught two bad briefs, keep using it.
