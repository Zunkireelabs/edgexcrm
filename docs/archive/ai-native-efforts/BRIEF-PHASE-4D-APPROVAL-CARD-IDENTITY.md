# BRIEF — Phase 4D: resolve entity identity on the approval card

**Branch:** stay on `feature/ai-phase-4-writes` (currently `a5cfa0e`, clean tree). Do **not** commit, push, or open a PR.

## The problem

Every entity reference on the write-approval card is rendered as a **raw UUID**. Found live: approving a task showed `Lead: eef51732-1fbf-485a-89fc-2777b9097985` instead of `Riya Sharma (ADM-001)`.

This is not cosmetic. **The approval card is the consent surface** — the single moment a human decides whether a write happens. A raw UUID means the user cannot verify *what they are approving*. In the live test the id happened to be correct, but the user had no way to know that; they approved on trust, not verification. That reduces the approval gate to a speed bump.

It matters more given a known behavior: during 4C testing the model **hallucinated a plausible-looking UUID** when handed a display id (`ADM-009`). If that happens on a write, the card shows a wrong-but-plausible UUID and the human approves it blind. The gate would look like it's working while protecting nothing.

### Every affected describer (all in `approval-card.tsx`)

| Tool | Raw id shown | Line |
|---|---|---|
| `create_task` | `assigneeId`, `leadId` | 30, 31 |
| `update_lead_stage` | `leadId` | 39 |
| `assign_lead` | `leadId`, `assigneeId` | 48, 49 |
| `create_lead_note` | `leadId` | 61 |
| `create_knowledge_item` | `knowledgeBaseId` | 71 |
| `undo_lead_action` | `actionId` | 55 |

`describeUpdateLeadStageInput` already prefers `stageName` over `stageId` (line 40) — that's the right instinct; this brief generalizes it.

**`undo_lead_action` is the worst case.** `Action: <uuid>` tells the user nothing about what is about to be reverted. Undo mutates data based on a prior action; the card must describe *that action* — e.g. `Undo: stage change on Riya Sharma (ADM-001), Pre-qualified → Qualified, 5 minutes ago`. Resolve it from `ai_write_actions` (columns: `id, tenant_id, user_id, conversation_id, tool_call_id, tool_id, input, status, result, error, undo_of, created_at`).

## How to resolve — read this before choosing an approach

⚠️ **Do NOT add a `leadName` (or similar) field to any tool's `inputSchema`.** That is the easy path and it is wrong: it would put **model-asserted text** on the consent surface. A model that hallucinates an id would also supply a confident, reassuring name, and the card would display a correct-looking name attached to the wrong record — strictly worse than showing the raw UUID, because it manufactures false confidence. **The display name must be resolved from the id against the database, server-side, tenant-scoped. Never from model output.**

Two acceptable implementations, in order of preference:

1. **Enrich the approval payload server-side.** Approval is wired via the AI SDK's `toolApproval` config (`adapter.ts:50-62`), so investigate whether the SDK allows attaching resolved data to the approval request before it reaches the client. If it does, resolve there — the adapter already holds a tenant-scoped `db`.
2. **Client-side resolver endpoint.** If (1) isn't supported, add a small authenticated endpoint that takes the ids present in a pending approval and returns display labels, scoped via `scopedClient(auth)`. The card calls it on render.

Either way the resolution is tenant-scoped through the normal auth path — a lookup must never be able to return another tenant's record.

## Unresolvable ids are a safety feature — do not hide them

If an id doesn't resolve, **say so prominently**: `Lead: NOT FOUND (eef51732-…)`, and make it visually distinct (destructive styling). Do not fall back to silently showing the raw id as if nothing were wrong, and do not hide the row.

An id that doesn't resolve is the strongest available signal that the model invented it. Surfacing it turns a silent failure into an obvious "deny this" prompt for the user. Consider whether the Approve button should be disabled in that state — propose a recommendation rather than deciding unilaterally, and explain your reasoning.

## Display format

- **Lead:** `Riya Sharma (ADM-001)` — name plus display id, since display id is what staff actually use.
- **Assignee:** the person's name; fall back to their email if no name is set. Keep the existing `"You"` when `assigneeId` is absent.
- **Knowledge base:** its name.
- **Undo:** a human sentence describing the original action, as above.

## Tests

- Each describer renders a resolved human label, not a UUID, for every id field in the table above.
- An unresolvable id renders the NOT-FOUND state, and the raw id is still visible for debugging.
- Cross-tenant safety: an id belonging to another tenant resolves as NOT FOUND, never as that tenant's real name. **Write this test explicitly** — it's the one that matters.
- `undo_lead_action` renders a description of the target action, not an id.
- Existing approval-card tests still pass.

## Gates

```bash
rm -rf .next && NODE_OPTIONS=--max-old-space-size=6144 npm run build
npx vitest run          # baseline on this branch: 396 passing
npm run lint            # 0 errors; no new warnings over the 46 baseline
NODE_OPTIONS=--max-old-space-size=6144 npx tsc --noEmit
```

## Live verification (local, `admizz-local`)

1. Ask the assistant to create a task for Riya Sharma. The card must read `Riya Sharma (ADM-001)`, not a UUID. Screenshot it.
2. Same for `create_lead_note` and `create_knowledge_item` — lead name and KB name resolved.
3. `assign_lead` — both lead and assignee resolved to names.
4. Force the NOT-FOUND path (hand-craft a tool call with a random UUID, or point at a cre-capital lead id from the admizz session) and show the card rendering it as not found.
5. `undo_lead_action` — card describes the prior action in words.

## Out of scope

- The `/orca/*` ungating gap (queued separately).
- The lead page having two panels that both read "No tasks yet" — the CHECKLIST panel reads `lead_checklists` while the Tasks tab reads `tasks`. Real UX confusion, separately queued, **not** part of this brief.

## Rules

- Stop at review. **No commit, no push, no PR.**
- No migration needed — this is read-side resolution only.
- If any part of this brief is wrong on inspection, **say so and stop** rather than working around it.
