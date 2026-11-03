# BRIEF — Phase 4A: Write-Tool Spine + `create_task` (interactive, approval-gated)

**For:** Sonnet executor session · **From:** Opus planner · **Date:** 2026-07-17
**Branch:** `feature/ai-phase-4-writes` (already exists, off `origin/stage`, housekeeping commit `79c5abd` on it — do NOT create a new branch)
**Plan context:** `docs/ai-native-efforts/04-PHASE-4-AUTONOMY-AND-WRITES.md` **§0.1 amendment** (read it first) + ADR-001 D2/D4.
**§0.1 ladder amendment SIGNED OFF by Sadin 2026-07-17** (ADR-001 Decision Log #6) — build is unblocked. Flag still ships off everywhere but local.

---

## 0. What this slice ships

The assistant learns to **act** — starting with the lowest-risk write: creating a real task. Everything rides the AI SDK v7 **native tool-approval** flow:

1. Model calls a `scope:"write"` tool → the SDK (because the tool declares `needsApproval`) emits an **approval-request part** into the stream instead of executing.
2. The chat UI renders an **ApprovalCard** (what will happen, from the tool input) with Approve / Deny.
3. User clicks → client calls `addToolApprovalResponse(...)` → follow-up request → the SDK verifies the approval (signed; `InvalidToolApprovalSignatureError` machinery) and runs the tool's server-side `execute` under the **logged-in user's own `AuthContext`** → model narrates the confirmed result.
4. Every proposal/decision/execution is recorded in a new `ai_write_actions` table + the existing `audit_logs`/`events` spine.

No agent identities, no automation levels, no Inngest — the human is present and decides each action. Assistant mode per ADR-001 D2: the tool can do exactly what the user could do in the UI, nothing more.

**Non-goals (do NOT build):** lead mutations (4B), notes/KB writes (4C), send_email, bulk writes, MCP, background agents, any UI settings for automation levels.

## 1. Ground rules (unchanged from Phases 1–3)

- All tool DB access via `ctx.db` (`scopedClient(auth)`); `createServiceClient` under `src/lib/ai/**` is ESLint-banned and a review-blocking defect.
- **AI SDK is v7** (`ai@7.0.29`, `@ai-sdk/react@4.0.32`). The plan docs' API names may be stale — **read the installed types in `node_modules/ai/dist/index.d.ts` and `node_modules/@ai-sdk/provider-utils/dist/index.d.ts` before wiring**. Verified present: tool-level `needsApproval` (boolean or function), `streamText`-level `toolApproval` config, `addToolApprovalResponse` on `useChat` (confirmed in `@ai-sdk/react@4.0.32`), `lastAssistantMessageIsCompleteWithApprovalResponses` (for `sendAutomaticallyWhen`), `ToolApprovalRequestOutput`/`ToolApprovalResponseOutput`/`ToolApprovalStatus`, denied-output types (`StaticToolOutputDenied`). **No new deps and no dep bumps** — everything needed is already installed.
- Mini-model junk-args (the 1B lesson): write-tool schemas MUST use the `sanitize.ts` helpers (`optionalString`/`optionalUuid`/`optionalFilterString`) — a placeholder NIL-uuid `assigneeId` on a WRITE is worse than on a read. Approval previews must show what will actually happen after sanitization/defaulting.
- No pushes, no PRs, no stage/prod DB access. Local Docker Supabase stack only (`127.0.0.1:54321/54322`).

## 2. Migration 172 — `ai_write_actions` (audit + idempotency spine)

New file `supabase/migrations/172_ai_write_actions.sql` (172 is the next free number — 171 exists; re-verify with `ls supabase/migrations | sort` before writing). Follow the house style: transactional, additive, rollback comment, ledger self-record INSERT, before/after counts. Apply to the LOCAL Docker DB only.

```sql
CREATE TABLE ai_write_actions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id uuid NOT NULL,                     -- the approving/acting user
  conversation_id uuid,                      -- ai_conversations.id when known
  tool_call_id text NOT NULL,                -- SDK toolCallId
  tool_id text NOT NULL,                     -- e.g. 'create_task'
  input jsonb NOT NULL,                      -- sanitized tool input as executed
  status text NOT NULL CHECK (status IN ('executed','denied','failed')),
  result jsonb,                              -- tool output on success (e.g. {taskId})
  error text,                                -- failure detail
  undo_of uuid REFERENCES ai_write_actions(id),  -- 4B uses this; nullable
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, tool_call_id)           -- idempotency anchor
);
```

RLS: enable; SELECT for tenant members via `get_user_tenant_ids()`; **no INSERT/UPDATE/DELETE policies** (rows are written only by server code through the service-role-backed scoped client, same posture as `ai_usage_events`). Index on `(tenant_id, created_at DESC)`.

## 3. Registry + adapter: write scope becomes real (flag-gated)

- `src/lib/ai/tools/registry.ts`: **remove the `scope === "write"` registration throw** (types.ts:24 comment updates too). `buildToolset(auth)` excludes write tools unless the new env flag **`AI_WRITE_TOOLS_ENABLED === "true"`** (read at request time like `AI_ASSISTANT_ENABLED`; absent ⇒ off ⇒ today's behavior byte-identical). Keep the existing industry/permission filters applying to write tools too.
- `src/lib/ai/tools/adapter.ts` (`toAiSdkTools`): for `scope:"write"` tools, set `needsApproval: true` on the SDK tool and wrap `execute` with, in order:
  1. **Idempotency check:** `ctx.db.from("ai_write_actions")` select on `tool_call_id` — if an `executed` row exists, return its stored `result` verbatim (no re-execution). The SDK passes the toolCallId into execute options — confirm the exact field in the installed types (`ToolCallOptions`); if it's genuinely unavailable, thread it via the approval config — do not skip this guard.
  2. Execute the tool body (which does its own domain-level writes via `ctx.db`).
  3. **Record:** insert `ai_write_actions` row (`executed` w/ result, or `failed` w/ error). Insert failure on the UNIQUE constraint ⇒ concurrent duplicate ⇒ treat as already-executed, return stored result.
  - **Denied path:** when the user denies, record a `denied` row. Hook this wherever the SDK surfaces the denial server-side (likely the denied tool output flowing through the next request / `onFinish` toolCalls — read the types; a small addition to the chat route's `onFinish` persistence is acceptable and in scope).
  - Read tools: zero behavior change (no `needsApproval`, no audit rows).
- Existing telemetry wrapper stays; add `scope` to the tool-call telemetry metadata.

## 4. The tool: `create_task`

**Do not reimplement task creation.** Extract the core of `POST /api/v1/my-tasks` (`src/app/(main)/api/v1/my-tasks/route.ts:92-244`) into a shared helper, e.g. `src/lib/tasks/create-task.ts` — `createTaskForUser(db: ScopedClient, auth: AuthContext, input): Promise<{task, notified}>` — and have **both** the REST route and the tool call it. Byte-identical REST behavior is a gate (the route's response shape, validation errors, side effects must not change). The helper carries over exactly:

- Validation: `title` required ≤255; `description` ≤2000; `priority ∈ [low,normal,high,urgent]`; `due_date` `YYYY-MM-DD`; `lead_id`/`deal_id`/`assignee_id` UUID.
- Tenant-scoped FK existence checks for `lead_id`/`deal_id`; assignee must be a `tenant_users` member; default `assignee_id = auth.userId`; `assigned_by_id` only when assignee ≠ self.
- Forced fields: `project_id: null, status: "todo", is_billable: false, position: 0`.
- Side effects: `emitEvent("task.created")`, `createAuditLog("task.created")`, `TASK_ASSIGNED` notification when assigning to someone else.

Tool file `src/lib/ai/tools/universal/create-task.ts`: `id: "create_task"`, `scope: "write"`, universal (no `industries`), no `requiredPermission` (any member can create own tasks — same as REST). Input schema (with sanitize helpers): `title` (required), `description?`, `priority?` (default `normal`), `dueDate?` (`YYYY-MM-DD`), `leadId?`, `assigneeId?` (omit ⇒ self; description must tell the model: "omit unless the user explicitly names someone else — never invent an assignee"). Output: `{taskId, title, assignedTo, dueDate, leadId}` + a short `note` for the model. Description written for the model: when to use (user asks to be reminded / to create a to-do / follow-up), and that the user must approve before it runs. Register in `universal/index.ts`.

## 5. Client: ApprovalCard in the shared chat brain

In `src/components/dashboard/ai-assistant/`:

- `use-assistant-chat.ts`: expose `addToolApprovalResponse`; add `sendAutomaticallyWhen: lastAssistantMessageIsCompleteWithApprovalResponses` (read the installed types for the exact composition — read tools still execute fully server-side, so approval responses are the only client round-trip that must auto-resend).
- New `approval-card.tsx`, rendered by `chat-message.tsx` when a tool part is in the approval-requested state (find the exact part state names via `isToolUIPart`/part `state` in the installed types): friendly tool label ("Create a task"), a field-by-field preview of the input (title, priority, due date, assignee → "you" when self, lead id when present), and **Approve** / **Deny** buttons → `addToolApprovalResponse` with the matching approval id. Disable buttons after decision; show decided state ("Approved — running…" / "Denied"). While a decision is pending, the composer stays usable.
- Decided/executed calls render through the existing tool-activity line (add `create_task` to the label map: "Creating task").
- **Accepted 4A limitation (document in a code comment):** pending approvals do not survive a page reload — `conversation-history.ts` reconstructs assistant rows as text-only, so an undecided proposal lapses; the user just asks again. No persistence work in this slice.
- Panel + Ask Orca both get this for free via the shared components — do not fork per surface.

## 6. Prompt additions (`src/lib/ai/prompts/assistant.ts`)

Add to the base system prompt: the assistant can **propose** actions with its action tools; every action needs the user's explicit approval before it runs; never state an action was completed unless the tool result confirms it; if denied, acknowledge and continue without re-proposing the identical action unprompted; never fabricate input values (omit optional fields it wasn't told about).

## 7. Flag + env

- `AI_WRITE_TOOLS_ENABLED=true` in local `.env.local` for dev/verification. **Do not** add to `deploy-staging.yml`'s AI env block or GitHub secrets — stage/prod ship dark for 4A (flag absent = off); flipping stage is a later Opus/Sadin action after sign-off.

## 8. Tests (vitest — extend, don't rewrite)

1. Registry: write tool registers without throwing; excluded from `buildToolset` when flag off; included when on; industry/permission filters still apply.
2. `createTaskForUser`: happy path; validation rejects (title missing/too long, bad priority, bad date); assignee-not-a-member reject; cross-tenant `lead_id` reject (mocked ScopedClient returning no row); default-self assignee; `assigned_by_id` only on delegation.
3. Adapter write-wrapper: idempotency (existing `executed` row ⇒ returns stored result, underlying execute NOT called); failure path records `failed`; denied path records `denied`.
4. REST parity: `POST /api/v1/my-tasks` route tests (new) proving the refactor kept behavior — at minimum happy path + one validation reject + assignee rule.
5. Schema sanitize: NIL-uuid/`""` `assigneeId`/`leadId` ⇒ treated absent.

All existing tests stay green (222 currently). This slice's isolation coverage is a **merge gate** per the §0.1 amendment.

## 9. Gates — run ALL, report raw output

1. `NODE_OPTIONS=--max-old-space-size=6144 npm run build` → exit 0.
2. `npm run lint` → 0 errors.
3. `npx vitest run` → all green (report count).
4. **`NODE_OPTIONS=--max-old-space-size=6144 npx tsc --noEmit` → clean.** (CI runs raw tsc; `next build` and vitest DON'T typecheck test files — this exact gap bit us in PR #227. Non-negotiable.)
5. Diff scope confined to: mig 172, `src/lib/ai/**`, `src/lib/tasks/create-task.ts` (new), `my-tasks/route.ts` (refactor only), `src/components/dashboard/ai-assistant/**`, test files, local `.env.local`. Anything else ⇒ flag as deviation with justification.
6. `grep -rn createServiceClient src/lib/ai/ src/industries/*/ai/` → clean.

## 10. Live verification (local Docker stack; cookie recipe in memory / prior briefs)

Dev server: `npm run build && node .next/standalone/server.js` (or `npm run dev`), Docker Supabase up. As `owner@cre-capital.local` (or admizz owner):

1. **Flag off:** chat works exactly as today; `create_task` absent from the toolset (verify via a "create a task" prompt → model has no tool, answers conversationally).
2. **Flag on, approve:** "Remind me to call Aisha Khan tomorrow" → model proposes `create_task` → ApprovalCard shows title/due date/assignee "you" → Approve → verify in DB: `tasks` row (correct `tenant_id`, `assignee_id`, forced fields), `ai_write_actions` row `executed` with result + tool_call_id, `audit_logs` `task.created`, `events` row — and the model's follow-up text confirms with the real task.
3. **Deny:** propose another task → Deny → NO `tasks` row; `ai_write_actions` row `denied`; model acknowledges gracefully.
4. **Idempotency:** re-send the same approval response via curl (replay the follow-up request) → still exactly ONE `tasks` row; second attempt returns the stored result.
5. **Scoping:** as `counselor@admizz.local` (counselor123456): create a task for self → lands with correct tenant + assignee; attempt input with the OTHER tenant's lead id (craft via direct tool execution like the 1B pattern, or curl) → rejected, no row.
6. **Delegation:** owner asks to assign a task to another member by name (use `team_lookup` flow) → approval card shows that assignee → Approve → `assigned_by_id` set + TASK_ASSIGNED notification row.
7. Reload mid-pending-approval → conversation reloads text-only, no crash; proposal lapsed.

If the OpenAI mini model refuses to call the tool or stuffs junk args, that's a findings item, not something to hack around silently — report it (sanitize should absorb junk; prompt hardening proposals welcome).

## 11. Report back

Standard format: what was built (file list), gate outputs (raw), live-check evidence (SQL results / transcripts), deviations from this brief with justification, anything discovered that Opus should review. **Do not commit** — Opus reviews first (two-session workflow). Do not push, PR, or touch stage/prod.
