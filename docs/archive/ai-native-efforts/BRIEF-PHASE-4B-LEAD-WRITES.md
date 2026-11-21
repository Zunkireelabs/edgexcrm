# BRIEF — Phase 4B: lead write tools (`update_lead_stage` + `assign_lead` + undo)

**For:** Sonnet executor session · **From:** Opus planner · **Date:** 2026-07-17
**Branch:** `feature/ai-phase-4-writes` (4A committed as `818fc62` — build on top, do NOT create a new branch)
**Plan context:** `04-PHASE-4-AUTONOMY-AND-WRITES.md` §0.1 Track-1 slice 4B ("the hard slice") + ADR-001 D2/D4. 4A's spine (mig 172, adapter write wrapper, ApprovalCard, `AI_WRITE_TOOLS_ENABLED`) is the foundation — reuse it; this slice adds NO migration and NO deps.

---

## 0. What this slice ships

1. **The centerpiece refactor:** extract the entire `PATCH /api/v1/leads/[id]` body (route.ts:163–~1166, ~1000 lines) into a shared service `src/lib/leads/apply-lead-patch.ts` — `applyLeadPatch(auth, leadId, body, opts)` — that BOTH the REST route and the new AI tools call. One code path for all lead-mutation governance, forever.
2. Three approval-gated write tools riding the 4A spine: `update_lead_stage` (education-scoped), `assign_lead` (universal), `undo_lead_action` (universal).
3. ApprovalCard previews + labels + prompt guidance for the new tools.

**Non-goals:** notes/KB writes (4C), send_email, bulk/multi-lead writes, any change to GET/DELETE in the same route file, migrating the service off `createServiceClient` (see §1), new UI beyond the existing shared chat brain.

## 1. The extraction — mechanical, parity-first

- New `src/lib/leads/apply-lead-patch.ts`. Move the PATCH body **verbatim** — every check, in order — replacing HTTP returns with a discriminated outcome:
  ```ts
  type ApplyLeadPatchOutcome =
    | { kind: "not_found" }
    | { kind: "forbidden"; message?: string }          // carries "First holder cannot revert this lead" etc.
    | { kind: "validation"; errors: Record<string, string[]> }
    | { kind: "db_error"; error: unknown }
    | { kind: "ok"; lead: Lead; changes: Record<string, {old: unknown; new: unknown}> };
  ```
  The route becomes a thin shell: parse body → `applyLeadPatch` → map outcome to `apiNotFound/apiForbidden/apiValidationError/apiServiceUnavailable("Failed to update lead")/apiSuccess` — **response shapes, status codes, and log lines byte-identical**.
- `opts: { requestId, ip, userAgent }` so `createAuditLog` parity holds. All side effects move WITH the body (syncOriginMembership, pool-row mirror, collaborators, auto-promote, assignDisplayIds, audit diff w/ list-name substitution, `lead.status_changed`/`lead.assigned`/`lead.list_changed` events, assignment-history insert w/ the `isRevert` exclusion, email-forward rules, notifications + assigned email). Nothing may be dropped or reordered.
- **Keep `createServiceClient` + the existing manual `.eq("tenant_id", ...)` filters verbatim inside the service.** This file is on the legacy migration list; converting ~30 queries to `scopedClient` in the same diff as the extraction would make regressions undiagnosable. The AI tools calling a service that uses the service client internally is SANCTIONED here (same trust level as the REST route itself; the `src/lib/ai/**` ESLint ban is about tool code hand-rolling raw queries, which this is not) — but every query you move must keep its tenant filter; Opus review greps for this.
- `changes` (the audit diff the route already computes) is what the tools use for undo snapshots — include it in the `ok` outcome.

## 2. Tool 1 — `update_lead_stage` (education_consultancy-scoped)

File lives in `src/lib/ai/tools/universal/` like the other cross-cutting tools, but declares `industries: [INDUSTRIES.EDUCATION_CONSULTANCY]` (the `get_form_submissions_summary` pattern — "Stage" = `lead_lists` is the education funnel concept; RE/it_agency tenants must not see this tool), **and must be added to `education-consultancy/ai/agent.ts` `toolIds`** or the packs sync test fails. The other two tools (§3/§4) are universal — no `industries`, no manifest entry.

- Input (sanitize helpers mandatory): `leadId` (required uuid), `stageName` (optional string — the human name, e.g. "Qualified"), `stageId` (optionalUuid). Exactly one of stageName/stageId required (schema `.refine`). Description: moves a lead to another Stage; user must approve; use search_leads first to get the lead id; never guess stage names.
- Execute: resolve the stage → `lead_lists` by tenant + case-insensitive exact `name` match (or id). Not found → `{error}` listing available accessible stage names (small tenant-scoped select, filtered through `canAccessList` — don't leak admin-only lists to a non-admin). Ambiguous → `{error}` asking to disambiguate. Then `applyLeadPatch(auth, leadId, { list_id })`. Map outcomes: not_found → "Lead not found." (same string as get_lead — no existence oracle); forbidden → its message or a generic refusal; validation → joined field errors (the prospect-qualification message must reach the model verbatim — it's actionable); ok → `{leadId, stage: <name>, previous: <changes-derived old values>, undoToken: see §4, note}`.
- All governance (revert rules, landing-stage reset, archive snapshot, prospect gate, §4.2) comes free from the service — the tool adds NOTHING of its own.

## 3. Tool 2 — `assign_lead` (universal)

- Input: `leadId` (required uuid), `assigneeId` (required uuid — description: resolve names with team_lookup first; never invent an id; assigning to yourself is allowed).
- Execute: `applyLeadPatch(auth, leadId, { assigned_to: assigneeId })`. Outcome mapping as §2. ok → `{leadId, assignedTo, previous, note}`. Chain governance, §4.2, cross-branch status reset, notifications/email all come from the service.
- No `requiredPermission` gate at registry level: own-scope users legitimately assign within their chain; the service is the authority (mirrors REST exactly). A plain counselor's attempt fails inside the service (ADMIN_ONLY_FIELDS) → recorded `failed` by the 4A adapter — correct.

## 4. Tool 3 — `undo_lead_action` (universal) + the `undoOf` adapter convention

Mig 172's `undo_of` column was built for this.

- Input: `actionId` (optionalUuid). Omitted ⇒ the calling user's most recent `ai_write_actions` row with `status='executed'` AND `tool_id IN ('update_lead_stage','assign_lead')` (tenant-scoped via ctx.db, `.eq("user_id", auth.userId)`, order created_at desc limit 1).
- Guards, each → `{error}`: no such row; row's `user_id !== auth.userId` (undo your own actions only); tool_id not in the allowlist; already undone (a row exists with `undo_of = <target id>` and status `executed`); no usable `previous` snapshot in `result`.
- Inverse patch: from the target row's stored `result.previous`, restore ONLY this allowlist: `list_id, assigned_to, status, stage_id, pipeline_id` (whichever are present). Passing status/stage_id explicitly makes the service's landing-stage block treat the caller as having set them (`callerSetStage`) — restoring exact prior values instead of re-deriving. Then `applyLeadPatch` as this user.
- **Undo obeys governance** — it re-runs the same checks as the forward action (e.g. a chain member's undo of a forward hand-off is a revert and hits revert rules; "First holder cannot revert" can legitimately block an undo). That is correct per ADR-001 D2 — surface the refusal, don't bypass. Document in the tool description ("undo may be refused by the same rules that govern manual moves").
- **Adapter convention (small, tested):** a write tool's result may carry `undoOf: <ai_write_actions.id>`. `executeWriteTool`'s insert (and the 3c repair update) copies it into the row's `undo_of` column (strip nothing — leave it in `result` too). `undo_lead_action` returns `undoOf: targetRow.id`; the other tools return `previous` (from outcome.changes old-values) so THEIR rows are undoable. ~10 lines in adapter.ts + one unit test.
- To make that work, §2/§3 tools must store `previous` in their RESULT (the adapter already persists result verbatim). `previous` = `{field: changes[field].old}` for the allowlist fields present in `changes` (use the raw `list_id` old value, not the name-substituted `changes.list` entry — read the route's diff-building code carefully: it deletes `changes.list_id` and adds `changes.list` with names; the tools need the uuid, so capture it from the outcome BEFORE that substitution, or have the service include a parallel `rawChanges`. Cleanest: service `ok` outcome carries both `changes` (as today, for audit parity) and `previousValues: Record<string, unknown>` (pre-substitution old values of every updated column). Do that.)

## 5. Client + prompt

- `approval-card.tsx` `INPUT_DESCRIBERS`: `update_lead_stage` (Lead: id, Stage: name-or-id), `assign_lead` (Lead: id, Assignee: id), `undo_lead_action` (Action: id or "most recent"). `APPROVAL_ACTION_LABELS`: "Move a lead to another stage" / "Assign a lead" / "Undo a lead action". `tool-labels.ts`: "Moving lead stage" / "Assigning lead" / "Undoing action".
- `prompts/assistant.ts` — inside the existing `hasWriteTools`-gated Actions paragraph (do NOT add unconditional text), append: for lead actions, find the lead with search_leads and the assignee with team_lookup first — ids come from tool results, never from memory or invention; if an action is denied or refused by permissions, report the exact reason.
- Update `assistant.test.ts` fixture accordingly (flag-off byte-parity test must still pass UNCHANGED — it proves the gating held).

## 6. Tests (extend; 272 currently green)

1. **REST parity (the merge gate):** new `route.test.ts` for `PATCH /leads/[id]` mocking `applyLeadPatch` — every outcome kind maps to the exact pre-refactor status/shape (404 / 403 with+without message / 422 / 503 / 200 envelope).
2. **Service:** unit tests with a scripted fake supabase client for the priority governance branches: counselor (member+own, no canAssignLeads) blocked on `assigned_to`; canAssignLeads caller allowed `assigned_to` but blocked `branch_id`; §4.2 — lead outside manager's branch → forbidden, target outside branch → forbidden; chain forward — allowed target passes, non-chain target forbidden; revert — prev-holder ok / non-peer forbidden / first-holder forbidden(message); list access denied → forbidden; prospect gate → validation with the academic message; happy stage move returns `previousValues` incl. old `list_id`/`status`/`stage_id`. Build one reusable scripted-client helper; don't chase every branch — these are the ones with distinct outcomes.
3. **Tools:** input schema sanitize (NIL uuid → absent; refine on stageName/stageId); outcome mapping per tool incl. "Lead not found." parity; undo guards (not-yours, already-undone, no-snapshot, allowlist).
4. **Adapter:** `undoOf` lands in the insert row (and repair path).
5. Existing 272 stay green — especially packs sync (education manifest gets `update_lead_stage`).

## 7. Gates — run ALL, report raw

1. `NODE_OPTIONS=--max-old-space-size=6144 npm run build` → exit 0
2. `npm run lint` → 0 errors
3. `npx vitest run` → all green (report count)
4. `NODE_OPTIONS=--max-old-space-size=6144 npx tsc --noEmit` → clean
5. Diff scope: `src/lib/leads/apply-lead-patch.ts`(+test, new), `leads/[id]/route.ts` (PATCH → thin shell; GET/DELETE untouched), 3 tool files (+tests), `universal/index.ts`, `education-consultancy/ai/agent.ts`, `adapter.ts`(+test), `approval-card.tsx`, `tool-labels.ts`, `prompts/assistant.ts`(+test), registry/packs test updates. NO migration, NO package.json. Anything else = deviation w/ justification.
6. `grep -rn createServiceClient src/lib/ai/ src/industries/*/ai/` → clean (the service in `src/lib/leads/` legitimately uses it; the ban covers AI folders only).
7. Every query moved into the service still carries its tenant filter — self-audit with `grep -n 'tenant_id' src/lib/leads/apply-lead-patch.ts` and eyeball each `.from(`.

## 8. Live verification (local stack; admizz-local; 4A cookie/server recipe — copy `.env.local` into `.next/standalone/` and kill servers by pid, not pkill -f)

1. **REST regression first** (flag irrelevant): as owner via curl, PATCH a lead's stage → 200, landing-stage fields set, audit `changes` has `list: {old,new}` names; PATCH with a bogus `list_id` → 422 same shape as before refactor; counselor PATCH `assigned_to` → 403. This is the extraction-parity smoke.
2. Flag on, **stage move E2E**: owner asks "Move Aisha Khan to <stage>" (model may need the 4A two-turn nudge) → ApprovalCard shows stage name → Approve → `leads.list_id` changed + landing stage/status set + `ai_write_actions` executed with `result.previous` holding old `list_id`/`status`/`stage_id` + `lead.list_changed` event + audit row.
3. **Assign E2E**: owner assigns to counselor by name (team_lookup flow) → Approve → assigned_to set, LEAD_ASSIGNED notification row, assignment-history row, `previous.assigned_to` captured.
4. **Undo E2E**: "undo that" → ApprovalCard → Approve → lead back to prior stage AND prior assignee/status; new `ai_write_actions` row has `undo_of` = the undone row's id; undoing the same action again → refused "already undone".
5. **Governance through the tool** (forge approval-responded via curl like 4A): counselor + `assign_lead` → refusal recorded `failed`; cross-tenant `leadId` → "Lead not found." recorded `failed`, zero writes; prospect-gate violation surfaces the academic message.
6. Idempotency replay of an approved stage move → one write, stored result returned.
7. Flag off → neither tool in toolset; REST PATCH unaffected.

If gpt-4o-mini won't drive a flow live, fall back to forged direct-execution for that check and say so — model reluctance is a findings item, not a blocker.

## 9. Report back

Standard format: file list, raw gate output, live evidence (SQL/transcripts), deviations w/ justification, discoveries for Opus. **Do not commit** (Opus reviews first — the extraction diff gets a line-by-line pass), no push/PR/stage/prod.
