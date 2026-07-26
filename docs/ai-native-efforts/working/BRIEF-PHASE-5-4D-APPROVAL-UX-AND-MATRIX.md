# BRIEF — Phase 5, slice 5.4d: approval UX + automation matrix + undo

**For:** the Sonnet executor session. **Author:** Opus planner. **Branch:** `feature/ai-phase5-agent-spine` (already checked out; origin HEAD `64e9f6ec`).
**Source of truth:** `docs/ai-native-efforts/04-PHASE-4-AUTONOMY-AND-WRITES.md` §3 (approval & undo UX) + §1 (the matrix).

This is the **first real UI of Phase 5**. Everything before it built machinery with no human surface. 5.4b/5.4c wrote approvals into `agent_approvals` and a full execute-on-approve path — **and there is no screen anywhere in the app that lists a pending approval or lets anyone decide it.** The `PATCH /api/v1/agent-approvals/[id]` route exists and nothing calls it. That is what this slice fixes, plus the automation matrix that lets an admin opt an agent up from draft-only, plus undo.

---

## 0. Working rules for this slice (read before touching anything)

1. **Local only.** Build and verify on the local Supabase stack. Do NOT push to `stage`, do NOT open/merge any PR, do NOT touch the stage or prod DB. Migrations are applied **locally only**.
2. **STOP AT REVIEW.** When the work is done and gates are green, write your report and stop. Do not commit, do not push, do not merge. Opus reviews the real diff and re-runs every gate independently; Opus handles the commit to the feature branch.
3. Local env, if it isn't up: `open -a OrbStack` → `supabase start` → `./scripts/migrate-apply.sh local`. Local DB `postgresql://postgres:postgres@127.0.0.1:54322/postgres`, API `127.0.0.1:54321`, login `admin@edgex.local` / `edgexdev123`.
4. **Next free migration number is 184.** Exactly one migration in this slice. Follow `supabase/migrations/_TEMPLATE.sql` and the house header format (rationale, expected before/after row counts, rollback line, `Applied: local only`, and the **required self-record** `INSERT INTO public.schema_migrations`).
5. Gate baseline you must not regress: **768 tests / 79 files**, `npx eslint --max-warnings 50` → **46 warnings, 0 errors** (that exact command, no `src/` argument), `npx tsc --noEmit` → 0, `npm run build` → exit 0. New code must be **net-zero new warnings**.
6. The `commit-msg` hook rewrites the co-author line. Irrelevant here since you are not committing.

---

## 1. What already exists — reuse it, do not rebuild it

Read these before writing code. Several of them already solve problems this slice would otherwise re-solve badly.

| Thing | Where | Why it matters here |
|---|---|---|
| Approval rows | `agent_approvals` (mig 181): `run_id, tool_id, tool_input, preview, status, requested_at, decided_by, decided_at, expires_at` | The queue you are building a UI for. |
| Decide API | `src/app/(main)/api/v1/agent-approvals/[id]/route.ts` (PATCH) | **Already complete.** Admin-only, tenant-scoped, only decides `pending`, persists then fires the Inngest event. Your UI calls this. Do not rewrite it. |
| The waiting gate | `src/lib/ai/agents/approval-gate.ts` → `runWriteApprovalGate` | Executes on approve via `executeApprovedWrite`, claim-then-execute on `ai_write_actions`. Do not change its execution semantics. |
| Policy resolution | `src/lib/ai/agents/policy.ts` → `resolveAutomationLevel`, `DEFAULT_AUTOMATION_LEVEL` | Default-deny. Your matrix writes the rows this reads. |
| **Preview row builder** | `src/lib/ai/tools/universal/lib/approval-resolve.ts` → `describeApprovalRows`, `collectApprovalRefs`, `resolveRowDisplay`, `PreviewRow`, `EntityRef` | Already has per-tool describers for `create_task`, `update_lead_stage`, `assign_lead`. **Reuse verbatim.** |
| **Server-side id→label resolution** | `POST /api/v1/ai/resolve-approval-refs` | Already tenant-scoped AND lead-visibility-scoped (`canViewLead`), already distinguishes `loading` / `notFound`. **Reuse verbatim.** |
| Interactive approval card (the visual precedent) | `src/components/dashboard/ai-assistant/approval-card.tsx` | Match its row/tone rendering conventions. |
| Undo primitives | `UNDOABLE_TOOL_IDS`, `UNDOABLE_LEAD_FIELDS`, `undoableLeadPrevious` in `.../universal/lib/lead-patch-result.ts`; `ai_write_actions.undo_of` (mig 173) | Previous values are **already captured** into `ai_write_actions.result.previous` by both lead executors. Undo has everything it needs. |
| Existing undo tool (reference, not to be reused directly) | `src/lib/ai/tools/universal/undo-lead-action.ts` | Chat-only, targets "my most recent action". Your undo is **by explicit id**. Mirror its guard list, not its targeting. |
| Audit helper | `src/lib/api/audit.ts` → `createAuditLog({tenantId, userId, action, entityType, entityId, changes})` | Doc-04 §1 requires the matrix change be audited. |
| Flags | `src/lib/ai/flag.ts`: `isAgentsEnabledForTenant`, `isWriteToolsEnabled` | See §7. |

⚠️ **`/api/v1/agents/*` is NOT this.** That's the education-consultancy recruitment-agent feature. AI agents are `agent_identities` / `/api/v1/agent-identities/*`. Do not touch `/api/v1/agents`.

---

## 2. Two defects in current `main`-of-this-branch that this slice MUST close

I verified both by reading source. Fix them as part of the slice; they are not optional polish.

### Defect A — write proposals leak into the suggestions queue with a fake "Accept" button

`buildPolicyEnforcedWriteTools` (`write-executor.ts:115`) inserts `agent_outputs` rows with `kind:"write_action_proposal"`, `status:"proposed"`. `getReviewQueue` (`queries.ts:268`) filters on `status='proposed'` with **no `kind` filter**. So today, in `/orca/review`:

- a write proposal renders through `PayloadPreview`'s fallback branch — a raw `<pre>{JSON.stringify(payload)}</pre>` dump of the tool input;
- it shows an **"Accept"** button which hits `PATCH /api/v1/agent-outputs/[id]` and merely flips the row to `accepted`. It executes **nothing**, never touches `agent_approvals`, and never signals the waiting Inngest gate;
- meanwhile the *real* approval sits in `agent_approvals` with no UI at all.

That is a misleading consent surface: an admin clicks Accept on what looks like an agent action, believes they approved it, and nothing happens. It also pollutes the acceptance-rate math in `getAgentFleet`/`getAgentDetail`.

### Defect B — the run reads "Completed" while its approvals are still pending

`agent-lead-triage.ts` marks the run `completed` inside `runAgent`, *then* calls `runWriteApprovalGate`, which can durably wait up to 48h. The Fleet card and detail drawer both show "Completed" and count it in `tasksCompleted` the entire time. (This is open item #2 from the phase state.)

---

## 3. Scope — six parts

Do them in this order; each is independently verifiable.

### Part 1 — migration 184: `awaiting_approval` run status

`supabase/migrations/184_agent_runs_awaiting_approval.sql`. Widen the `agent_runs.status` CHECK (currently `('running','completed','failed','cancelled')`, from mig 179 line 56) to include `'awaiting_approval'`.

Model the header and the drop/re-add shape on **mig 183**, which does exactly this to `ai_write_actions.status`. Additive, transactional, rollback line, before/after counts (row count unchanged — widening a CHECK against 0 out-of-set rows), self-record in `schema_migrations`.

### Part 2 — the run actually reports awaiting_approval

In `runWriteApprovalGate` (`approval-gate.ts`):

- after the create-approval loop, **if `queued.length > 0`**, one `step.run("mark-awaiting-approval", …)` setting that run's `status = 'awaiting_approval'`;
- after `Promise.all` of the waits resolves, one `step.run("mark-approvals-settled", …)` setting it back to `'completed'`.

Both must be their own memoized steps (same reasoning as the existing per-proposal steps: a combined step re-runs its whole body on retry). Guard both updates with `.eq("id", runId)`.

A run left stuck at `awaiting_approval` after a crash is **intentional and visible** — same philosophy as a row stuck at `claimed`. Say so in a comment.

Then teach the read surfaces about it:
- `RUN_STATUS_LABELS` in `agent-detail-drawer.tsx` → `awaiting_approval: "Awaiting approval"`, and a `RUN_STATUS_TEXT` entry (amber).
- `getAgentFleet` / `getAgentDetail` in `queries.ts`: `tasksCompleted` counts `status === "completed"` only — that is already correct and now becomes honest. **Do not** add `awaiting_approval` to that count. Add a short comment saying why, so a later reader doesn't "fix" it.

### Part 3 — the approvals queue UI (the core of the slice)

**Server query.** New `getPendingApprovals(tenantId): Promise<AgentApprovalItem[]>` in `src/lib/ai/agents/queries.ts`, following the shape and idioms of the existing `getReviewQueue` (tenant-scoped via `scopedClientForTenant`, batch-fetch related rows, no N+1):

```ts
export interface AgentApprovalItem {
  id: string;
  toolId: string;
  toolInput: unknown;
  runId: string;
  agentId: string;
  agentName: string;
  subjectType: string | null;   // from the agent_runs row
  subjectId: string | null;
  requestedAt: string;
  expiresAt: string;
}
```

Filter `status = 'pending'`, newest first. Join agent name via `agent_runs.agent_id` → `agent_identities.display_name` (`agent_approvals` has no `agent_id` — `loadAgentRunContext` shows the join). Batch both lookups with `.in(...)`, one query each.

**Rendering — this is the part with the safety invariant.** New client component `src/components/dashboard/orca/approvals-section.tsx`:

- Build rows with `describeApprovalRows(item.toolId, item.toolInput)`.
- Collect refs with `collectApprovalRefs(rows)`, POST them to `/api/v1/ai/resolve-approval-refs`, render each row through `resolveRowDisplay(row, resolved)`.
- **Never render an id from `tool_input` as if it were a label.** A `notFound` ref must stay visible and styled destructively — that is a safety feature, not an error state (see the docstring in `approval-resolve.ts` and `BRIEF-PHASE-4D-FIXUP` finding 1). Copy the tone handling from `approval-card.tsx`.
- **Do NOT render from the stored `agent_approvals.preview` column.** That column is a stub (`buildApprovalPreview` writes `Run "toolId" with input {...}`) stamped at creation time with no viewer AuthContext to scope visibility against. Leave the column and the function alone — it stays a durable record of what was proposed — but add a one-line comment on `buildApprovalPreview` saying the UI deliberately re-derives the preview at view time from `tool_input`.
- Show the agent name, relative requested time (`formatAgentRelativeTime`), and an **expiry hint** ("Expires in ~N hours" from `expiresAt`). The 48h window is real and an approver needs to see it.
- Buttons: **Approve** / **Reject**. Both `PATCH /api/v1/agent-approvals/[id]` with `{decision: "approve"|"reject"}`. Optimistically remove the row, `toast`, `router.refresh()` — mirror `review-content.tsx`'s `decide()` exactly, including its error handling.
- **No "Edit input then approve" in this slice.** Doc-04 §3 lists it; it is deliberately deferred (editing tool input changes what a claimed `tool_call_id` executes, and interacts with the claim-then-execute contract). Note it as a follow-up in your report.
- Mobile-friendly layout (doc-04 §3: "approvals are the daily touchpoint"). Stack rows, full-width buttons under `sm`.

**Where it goes.** Fold into the existing `/orca/review` page as a **section above** the suggestions list — one review surface, one nav badge, one habit. `src/app/(main)/(dashboard)/orca/review/page.tsx` fetches both `getPendingApprovals` and `getReviewQueue` in a `Promise.all` and passes both into `ReviewContent`, which renders `<ApprovalsSection>` then its existing suggestions list under a clear "Suggestions" heading.

Copy must distinguish the two: approvals are **"Actions awaiting your approval — these will change your CRM"**; suggestions are **"Suggestions — drafts for you to act on"**.

**Nav badge.** `getPendingReviewCount` currently counts only `agent_outputs`. Make it the sum of pending suggestions + pending approvals so the badge doesn't under-report the consequential half. Keep it one function; keep it `head:true` count queries.

### Part 4 — close Defect A

In `getReviewQueue`, exclude write proposals that already have an approval row driving them: add `.neq("kind", "write_action_proposal")`… **but not blindly.** Two sub-cases:

- `automation_level === "agent_human"` → has a real `agent_approvals` row → surfaces in the Approvals section → **must not** also appear in Suggestions. Excluded.
- `automation_level === "human_led"` → **no approval row is ever created for it** (`loadAgentHumanWriteProposals` filters to `agent_human`). These are legitimate review items: "the agent wanted to do X and isn't allowed to." They must keep appearing.

`automation_level` lives inside the `payload` JSONB, so a `.neq("kind", …)` alone is wrong. Simplest correct approach: keep fetching `write_action_proposal` rows and filter in JS after the fetch (the function already post-processes in JS), dropping only those whose `payload.automation_level === "agent_human"`. Add the reason as a comment.

For the `human_led` ones that remain, fix the rendering honesty in `review-content.tsx`:
- render them via `describeApprovalRows(payload.tool_id, payload.input)` instead of the raw-JSON fallback (a static row list is fine here — no ref resolution needed for this sub-case if it complicates things, but if you reuse the resolving row component, better);
- the primary button must **not** say "Accept". It executes nothing. Label it **"Dismiss"** and **"Mark handled"** (`decision: "accept"` on the wire is fine — that's the existing status vocabulary) and add a line of copy: *"This agent isn't authorized to perform this action — it's shown for your awareness."*
- add `write_action_proposal` to the excluded set for the Edit affordance (it is already excluded via `EDITABLE_KINDS`; verify, don't assume).

### Part 5 — the automation matrix (per-agent × per-tool)

**API — read.** Extend `getAgentDetail` (`queries.ts`) to include:

```ts
toolPolicies: Array<{ toolId: string; label: string; automationLevel: AutomationLevel }>;
```

Derived from the agent's `AgentDefinition.toolIds`, filtered to registry tools with `scope === "write"` (use the same `getRegisteredTools()` lookup `capabilities.ts` uses — and note `capabilities.ts` imports `@/lib/ai/tools/packs` at module load for exactly this reason; `queries.ts` already imports `@/lib/ai/agents/packs`, confirm the tool registry is actually populated on this path or add the import). `label` = the phrase from `WRITE_TOOL_PHRASES` (export it from `capabilities.ts`). `automationLevel` = the stored row, or `DEFAULT_AUTOMATION_LEVEL` when absent. This rides the existing admin-only `GET /api/v1/agent-identities/[id]`; no new read route.

**API — write.** New `PATCH /api/v1/agent-identities/[id]/tool-policies/route.ts`. Body `{ toolId: string, automationLevel: string }`. Standard house pattern: `authenticateRequest()` → `requireAdmin(auth)` → `scopedClient(auth)`. Validation, all of it, server-side — never trust the disabled attribute in the UI:

1. `agent_identities` row must exist **in this tenant** (`scopedClient` + `.eq("id", id)` + `maybeSingle` → `apiNotFound`).
2. `toolId` must be a registry tool with `scope === "write"` **AND** be declared in that agent's own definition's `toolIds`. Anything else → `apiValidationError`. (Otherwise you can store a policy for a tool the agent doesn't have, or a typo silently no-ops forever.)
3. `automationLevel` must be `'human_led'` or `'agent_human'`. **`'fully_automated'` → 422 with a plain-language message.** It has two unmet prerequisites (no human actor for the `NOT NULL ai_write_actions.user_id`; doc-04 §2's prompt-injection containment does not exist yet) and the executor fails closed on it. Refusing it at the API is the real gate.
4. **`send_email` is pinned to `human_led`** regardless of anything else (doc-04 §2: "ships default `human_led` and stays there until a tenant explicitly opts up"). It isn't in any agent definition today; pin it anyway so it can't be loosened the moment it is added.
5. Upsert on `(tenant_id, agent_id, tool_id)` — the UNIQUE from mig 181 — setting `automation_level`, `updated_by = auth.userId`, `updated_at = now()`. `scopedClient.upsert()` requires `tenant_id` in the `onConflict` list: `onConflict: "tenant_id,agent_id,tool_id"`.
6. **Audit it** (doc-04 §1: "loosening is an explicit admin/owner action, audited"): `createAuditLog({ tenantId, userId: auth.userId, action: "agent_tool_policy.updated", entityType: "agent_identity", entityId: id, changes: { [toolId]: { old, new } } })`. Read the old value first so `changes` is real.

**UI.** The `Settings2` "Configure" button on the fleet card is currently dead — `agents-content.tsx:349-352` has the literal comment *"Automation-level settings — 5.4, stays dead until then"*. Wire it. It opens a dialog (reuse the `Dialog` already imported in that file) that fetches `/api/v1/agent-identities/[id]` and lists one row per write tool with a 3-option `Select`:

| Value | Label | Copy |
|---|---|---|
| `human_led` | Draft only | "The agent proposes; nothing changes until a person does it themselves." |
| `agent_human` | Needs approval | "The agent prepares the action and it runs only after you approve it — under your own permissions." |
| `fully_automated` | Fully automatic | **Disabled.** "Not available yet — requires agent actor attribution and prompt-injection containment." |

Render `fully_automated` **disabled and visible**, not hidden. Showing the top rung greyed out with the reason is more honest than pretending the ladder has two rungs, and it stops an admin from setting a level the executor would silently refuse.

If an agent has **no** write tools, the dialog says so plainly rather than rendering an empty list.

Also fix the stale badge while you're in this file: `agents-content.tsx:321-324` hardcodes a **"Draft-only"** `ShieldCheck` chip on every fleet card. That is now false for an agent with any write tool at `agent_human`. Drive it from `capabilities.guarantee`/`capabilities.writes.length` the way the detail drawer and the hire dialog already do — `capabilities.ts` already computes the correct two-way copy (`DRAFT_ONLY_GUARANTEE` vs `POLICY_GATED_WRITE_GUARANTEE`) and the fleet card is the one surface ignoring it.

### Part 6 — undo

**Route.** New `POST /api/v1/agent-writes/[id]/undo/route.ts`, where `[id]` is an `ai_write_actions.id`.

`authenticateRequest()` → `requireAdmin(auth)` → `scopedClient(auth)`. Guards, mirroring `undo-lead-action.ts` but targeting by explicit id:

1. Target row exists in this tenant; else `apiNotFound`.
2. `status === 'executed'`; else validation error.
3. `tool_id ∈ UNDOABLE_TOOL_IDS`; else `Action "<tool>" cannot be undone.`
4. `agent_id IS NOT NULL` — this route is for **agent** writes. Interactive chat writes already have their own undo path (`undo_lead_action`); do not create a second one for them.
5. `result.previous` yields at least one field in `UNDOABLE_LEAD_FIELDS`; else `No prior state was recorded for this action — cannot undo.`
6. `input.leadId` present; else `Could not determine which lead to restore.`

**Execution — reuse claim-then-execute.** Do not `select`-then-`insert` to check "already undone"; a double-click races that check. Instead:

- deterministic `tool_call_id = "undo:" + targetId`, so the mig-173 `UNIQUE (tenant_id, tool_call_id)` **is** the race-free ownership check;
- insert the `ai_write_actions` row at `status:'claimed'` with `undo_of: targetId`, `user_id: auth.userId`, `agent_id`/`run_id` copied from the target for provenance;
- on `23505`, read the existing row back and apply exactly the 5.4c-FIXUP semantics: `executed` → "This action was already undone."; `claimed` → refuse, needs human follow-up; `failed` → fall through and repair;
- then `applyLeadPatch(auth, leadId, patch, {requestId, ip, userAgent})` — **as the acting admin's own `AuthContext`**, which you already have from `authenticateRequest()`. No `buildUserAuthContext` needed here (that exists only because the Inngest gate has no session). The undo runs at exactly the permissions of the person clicking it;
- finalize the row to `executed` + result, or `failed` + error.

A governance refusal from `applyLeadPatch` (e.g. *"First holder cannot revert this lead"*) is **expected behavior, not a bug** — surface the message plainly via `leadPatchErrorResult`, finalize as `failed`, return a 4xx with that message.

**UI.** New "Actions taken" section in `agent-detail-drawer.tsx` (already admin-only, already fetching `getAgentDetail`). Extend `getAgentDetail` to return the agent's recent executed `ai_write_actions` rows:

```ts
recentWrites: Array<{
  id: string; toolId: string; input: unknown; result: unknown;
  status: string; createdAt: string; approvedBy: string | null; undone: boolean;
}>;
```

Cap at 20, newest first, `agent_id = agentId`. `approvedBy` resolved through `tenant_users` + `db.raw().auth.admin.getUserById` — **reuse the tenant-membership-first pattern from `resolve-approval-refs`'s `fetchAssigneeLabel`**; that membership check is what stops another tenant's user id resolving to their real name. Batch it, don't call per row. `undone` = an `ai_write_actions` row exists with `undo_of = this.id` and `status = 'executed'` (one `.in("undo_of", ids)` query, not N).

Each row shows: what happened (a sentence, from the same describers — never a raw id), a **provenance badge** ("Agent action · approved by <name>"), relative time, and an **Undo** button — shown only when `toolId ∈ UNDOABLE_TOOL_IDS && !undone`, replaced by an "Undone" chip otherwise.

**Accepted tradeoff, state it in your report:** undo lives in the per-agent drawer, so an admin who just approved something has to open the agent to undo it. That is deliberate for this slice (one implementation, existing admin-only surface). Add a single link from the approvals section header — "See actions already taken →" pointing at `/orca/agents` — and log "undo from the approval surface / a global activity feed" as a follow-up.

---

## 4. Non-goals — do not build these

- **`fully_automated` anything.** Blocked on actor attribution + injection containment. The UI shows it disabled; the API rejects it. That is the entire treatment.
- **Edit-input-then-approve.** Deferred (interacts with claim-then-execute's `tool_call_id` contract).
- **`send_email`.** Stays out of every agent definition and pinned at `human_led`.
- **MCP** — that's 5.5.
- Touching `/api/v1/agents/*` (recruitment agents), `write-executor.ts`'s draft semantics, or `executeApprovedWrite`'s execution/claim semantics.
- Any change to the anon-RLS P0 (mig 180) — already fixed in code, ships with the batch.
- Replacing `overview-content.tsx`'s `MOCK_STATS`. Out of scope, however tempting.

---

## 5. Tests (Vitest) — required, and they are the gate

Doc-04 §5 names most of these. New tests must be real assertions against real logic, not mocks asserting mocks. Follow the existing suites' style (`approval-gate.test.ts`, `queries.test.ts`, `route.test.ts` files under `api/v1/agent-*`).

**Policy matrix API** (`tool-policies/route.test.ts`):
- `fully_automated` → 422, and **no row written**.
- `send_email` → rejected regardless of level.
- a `toolId` not in the agent's definition → validation error, no row.
- a read-scope tool id → validation error.
- non-admin → 403; unauthenticated → 401.
- **cross-tenant probe**: admin of tenant A PATCHing an `agent_identities` id belonging to tenant B → 404, and tenant B's policy rows unchanged. (This is the ADR-D4 isolation requirement each write slice carries — see doc-04 §0.1.)
- happy path: `human_led → agent_human` upserts one row with the right `updated_by`, and re-PATCHing the same triple updates rather than duplicating (proves the `onConflict` list is right).

**Undo route** (`agent-writes/[id]/undo/route.test.ts`):
- non-undoable `tool_id` → refused.
- already-undone target → refused, and no second row created.
- **double-submit**: two concurrent undos of the same target produce exactly one `executed` undo row (the `23505` path).
- `agent_id IS NULL` (interactive write) → refused.
- missing `result.previous` → refused with the specific message.
- **cross-tenant probe**: admin of tenant A undoing tenant B's `ai_write_actions` id → 404, no mutation.
- an `applyLeadPatch` governance refusal → row finalized `failed`, error message surfaced, lead unchanged.

**Queries**:
- `getPendingApprovals` returns only `pending`, only this tenant, with the agent name joined.
- `getReviewQueue` **excludes** `write_action_proposal` rows whose `payload.automation_level === "agent_human"` and **includes** the `human_led` ones (Defect A, both directions — this is the one test that proves the fix isn't blunt).
- `getPendingReviewCount` = suggestions + approvals.

**Approval gate** (extend `approval-gate.test.ts`):
- with proposals → run goes `awaiting_approval` then back to `completed`;
- with zero proposals → run status untouched (no spurious update).

Live-DB isolation coverage: extend `scripts/rls-probe.ts` if and only if it's the natural home for the cross-tenant probes above; otherwise the route tests carry them. Whichever you choose, say so explicitly in your report. `npx tsx scripts/rls-probe.ts` must still report **13/13** (or more, if you added cases — state the new expected number).

---

## 6. Verification you must actually perform (not assert)

1. `npx vitest run` — report the **exact** file/test counts. Baseline 768/79; state the new numbers.
2. `npx eslint --max-warnings 50` — exact command, no `src/` argument. Must be **0 errors** and **≤46 warnings**. If your new code adds warnings, fix them; net-zero is the bar.
3. `npx tsc --noEmit` — 0 errors.
4. `npm run build` — exit 0 (free port 3000 first).
5. `./scripts/migrate-apply.sh local` applies 184 cleanly; confirm the `schema_migrations` self-record row exists.
6. `npx tsx scripts/rls-probe.ts` — state the result.
7. **Hands-on in the browser** (`npm run dev`, log in as `admin@edgex.local` / `edgexdev123`). You will need a seeded pending approval — create one directly via SQL against `agent_approvals` + a matching `agent_runs`/`agent_identities` row if no agent run is convenient. Verify and report what you actually saw:
   - `/orca/review` lists the pending approval with **resolved human labels**, not UUIDs;
   - a deliberately bogus lead id in `tool_input` renders as a visible destructive **NOT FOUND**, not a silent raw id;
   - Reject removes it and the row is `rejected` in the DB;
   - Approve → row `approved` + `decided_by` set (the Inngest execution won't run without the dev Inngest server — say so plainly rather than claiming the write executed);
   - the Configure dialog opens, shows the agent's write tools, **`fully_automated` is disabled**, and saving `agent_human` writes exactly one `agent_tool_policies` row;
   - the drawer's Actions-taken section renders a seeded executed write with its provenance badge, and Undo restores the previous value.

**Report honestly.** If something is unverified — no Inngest dev server, no convenient seed — say "not verified, here's why". A skipped check reported as passed is worse than a skipped check.

---

## 7. Flag posture

`/orca/*` already sits behind `isAssistantEnabled() && tenant.ai_enabled` in `orca/layout.tsx`. Everything you build inherits that.

Do **not** add a new env flag. The matrix's real safety gate is per-tenant data (`agent_tool_policies` defaults to nothing → `human_led`) plus `isAgentsEnabledForTenant`, both already in place. One judgement call to make and state: the write path that a loosened policy unlocks runs inside the Inngest agent path, which is governed by `isAgentsEnabledForTenant`, not by `isWriteToolsEnabled` (that flag gates the *interactive chat* toolset). Confirm that reading against `runtime.ts`/`write-executor.ts` and report what you found — if agent writes turn out to be reachable with `AI_WRITE_TOOLS_ENABLED=false`, **say so** rather than quietly adding a gate.

---

## 8. Deliverable

A working tree on `feature/ai-phase5-agent-spine` with the changes and passing gates, plus a report containing:

- every file added/changed, one line each on why;
- the exact gate numbers (tests, eslint warnings, tsc, build, rls-probe);
- what you verified in the browser and what you did **not**;
- the flag-posture finding from §7;
- any place you deviated from this brief and why (deviations are fine when the code disagrees with me — the brief is written from reading source, not from running it; unexplained deviations are not);
- follow-ups you're deliberately leaving: edit-then-approve, undo discoverability, `fully_automated`'s two prerequisites.

**Then stop.** No commit, no push, no PR. Opus reviews the real diff and re-runs every gate.
