# BRIEF — Phase 4A FIXUP: write-spine review findings

**For:** Sonnet executor session · **From:** Opus reviewer · **Date:** 2026-07-17
**Branch:** `feature/ai-phase-4-writes` — the 4A build is UNCOMMITTED in the working tree; this fixup amends it in place (still no commit — Opus re-reviews, then commits both together).
**Context:** Opus's independent review of the 4A build (BRIEF-PHASE-4A-WRITE-SPINE.md). All gates re-ran green and the approve/deny/idempotency/cross-tenant spine verified live — but review found 1 live-proven blocking bug, 1 flag-off parity regression, and made the audit-semantics design calls Sonnet's report asked for (finding #3). Everything below is in scope; nothing else is.

---

## 1. BLOCKING — denied-row batch insert loses every denial after the first

**Proven live by Opus:** deny A (row recorded) → later turn denies B with A's part still in the replayed history → `buildDeniedWriteActionRows` returns [A, B] → single `.insert([A, B])` hits the UNIQUE(tenant_id, tool_call_id) conflict on replayed A → **PostgREST aborts the whole statement, B's row is never written**, and the error is swallowed by the "23505 is benign" guard (no log either). Since the client replays full history every turn and a denied part stays `approval-responded` forever, every denial after a conversation's first is permanently missing from the audit trail. Local DB shows it: `call_opus_deny_A` has a row, `call_opus_deny_B` does not (conversation kept for your re-verify).

**Fix:** in the chat route's `onFinish`, replace the batch `.insert(deniedRows)` with

```ts
db.from("ai_write_actions").upsert(deniedRows, { onConflict: "tenant_id,tool_call_id", ignoreDuplicates: true })
```

(`scopedClient.upsert()` is ON-CONFLICT-aware and injects/strips tenant_id — see scoped.ts docstring; `onConflict` MUST include `tenant_id`.) Keep logging any non-null error (the 23505 carve-out becomes unnecessary — with `ignoreDuplicates` a duplicate is silently skipped, so any surfaced error is real).

**Verify live (the exact scenario above):** deny A → new turn with A in history + deny B → **both** rows `denied` in `ai_write_actions`.

## 2. BLOCKING for stage — "Actions:" prompt paragraph must be conditional on write tools

The new paragraph (which names `create_task`) is added to the system prompt **unconditionally** — including when `AI_WRITE_TOOLS_ENABLED` is off. That breaks flag-off parity, and it measurably degrades flag-off behavior: in 3 independent live runs, "Create a task titled … Do it now" made the model hunt through `list_my_tasks` up to the 6-step cap and return **empty text** (vs. a plain conversational answer pre-4A). Stage/prod ship flag-off, so this would regress live tenants.

**Fix:** `buildSystemPrompt` gains a `hasWriteTools: boolean` option; include the Actions paragraph only when true. The chat route passes `toolset.some((t) => t.scope === "write")`. Update `assistant.test.ts`: paragraph present when `hasWriteTools: true`; when false, the full-prompt fixture must be **byte-identical to the pre-4A prompt** (no Actions paragraph, no extra blank line).

## 3. Audit semantics — design calls (this closes your report's finding #3)

`ai_write_actions.status` must mean what an auditor thinks it means: **`executed` = the domain write took effect.** Three changes in `adapter.ts`'s `executeWriteTool` (+ tests in adapter.test.ts for each):

a. **Soft-reject ⇒ `failed`.** Our tools' house convention returns `{ error: string }` for domain rejects (validation, cross-tenant, etc.). After `execute()`, if the result is a plain object with a string `error` property, record the row as `status: 'failed'`, `error` = that string (keep the full object in `result` too). The value returned to the model is unchanged. (Live artifact to fix retroactively: nothing — local rows are throwaway; new rows just classify correctly. Note a 'failed' row doesn't short-circuit the idempotency check, so a replayed reject simply re-rejects — fine.)

b. **`denied` is terminal.** If the up-front idempotency select finds an existing row with `status: 'denied'` for this tool_call_id, do **not** execute; return `{ error: "This action was denied by the user and will not be run. Propose a fresh action if it's still needed." }`. (Today a forged/late approval replay on a denied call executes the write while the audit row still says `denied` — an integrity hole Opus confirmed by reading the code path.)

c. **Repair stale rows on the conflict path.** In the 23505 handler after a successful execute, when the raced row exists but its status is NOT `executed` (e.g. a stale `failed` from an earlier attempt), `update` that row to the fresh outcome (`status`, `result`, `error: null`) — filtered `.eq("tool_call_id", toolCallId)` — instead of only logging, then return our result. (Remember scoped `.update()` requires the caller-supplied filter.)

## 4. Minor — my-tasks route lost the DB error in its log

`CreateTaskDbError` should carry the Postgrest error (`{ kind: "db_error", error }`) so the route can restore its pre-refactor `log.error({ error }, "Failed to create task")`. The AI tool keeps ignoring the detail (generic message to the model).

## 5. Cheap prompt nits (both live-observed)

- Denied tool results read as errors to the model — live deny produced "It seems there was an issue creating the task." Add one line to the Actions paragraph: a denied result means the user declined — acknowledge the decision plainly; it is not an error.
- Finding #1 mitigation attempt (allowed, not gated): the tool description's opening "Propose creating a real task…" plausibly teaches the model that *chat text* is the proposal mechanism (live: model narrated a proposal and asked "Should I proceed?" instead of calling the tool; only called it on the follow-up turn). Reword to lead with the action — e.g. "Create a real task/to-do/reminder… The user is shown the exact details and must approve before it runs." Report whether first-turn tool-calling improves across ~5 prompts; if it doesn't, that's fine — it stays a known mini-model behavior.

## Out of scope (parked, do not build)

`experimental_toolApprovalSecret` HMAC signing (verified available in installed ai@7.0.29 — future hardening slice; forgery today is bounded to the user's own authority), pending-approval reload persistence (accepted 4A limitation), any 4B lead-write work.

## Gates — rerun ALL, report raw

1. `NODE_OPTIONS=--max-old-space-size=6144 npm run build` → exit 0
2. `npm run lint` → 0 errors
3. `npx vitest run` → all green (count; was 266)
4. `NODE_OPTIONS=--max-old-space-size=6144 npx tsc --noEmit` → clean
5. Diff scope: adapter.ts(+test), chat route, prompts/assistant.ts(+test), tasks/create-task.ts(+route/tool touch for #4), universal/create-task.ts(+test). Anything else = deviation.
6. Live re-verify: item-1 two-deny scenario (both rows), item-2 flag-off prompt parity + one flag-off "create a task" transcript, item-3a cross-tenant leadId probe now records `failed`, item-3b denied-then-approved replay refuses to execute, approve+replay still idempotent (1 task row).

**Do not commit / push / PR / touch stage-prod.** Report back for Opus re-review.
