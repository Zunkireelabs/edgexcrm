# BRIEF — Phase 4D fixup (Opus review findings)

**Branch:** stay on `feature/ai-phase-4-writes` (`a5cfa0e`). Work is uncommitted in the tree — expected. Do **not** commit, push, or open a PR.

4D is well-built and all gates are green (build 0, 442 tests, lint 0 errors/46 warnings, tsc 0). The `tenant_users` membership check before `auth.admin.getUserById` correctly closes the cross-tenant leak — that was the hard part and you got it right.

Two gaps remain, both the same class: **`scopedClient` filters by `tenant_id` only.** It is not the whole permission model. Within a tenant, counselors are restricted to their own leads and users are restricted to their own write actions, and neither restriction is applied here.

Both are information disclosure, not corruption. Both are small.

---

## Finding 1 — lead resolution isn't lead-scope-aware

`fetchLeadLabel` in `src/app/(main)/api/v1/ai/resolve-approval-refs/route.ts` resolves any lead id in the caller's tenant. A **counselor can POST any lead UUID in their tenant** and receive `Riya Sharma (ADM-001)` — a lead they are not permitted to see.

CLAUDE.md states the invariant directly: counselor scoping *"must be maintained in any new lead-related endpoints."* This is a new lead-related endpoint.

It doesn't matter that the card only ever asks about ids the user's own scoped `search_leads` surfaced. This is a general-purpose resolver that accepts arbitrary refs from any authenticated caller — the normal flow is not the security boundary.

### Do

Apply the same scoping every other lead-touching AI tool uses. The canonical version is `src/lib/ai/tools/universal/activity-timeline.ts:25-38`:

```ts
const lead = await db.from("leads").select("id, assigned_to, branch_id")
  .eq("id", leadId).is("deleted_at", null).maybeSingle();
if (!lead) return null;
const membership = await getLeadMembership(db, leadId);
const isAssignee = membership.some((m) => m.assigned_to === auth.userId) || lead.assigned_to === auth.userId;
if (shouldRestrictToSelf(auth.permissions) && !isAssignee && !(await isLeadCollaborator(db, leadId, auth.userId))) return null;
if (!requireLeadBranchAccess(auth, lead, membership)) return null;
```

`fetchLeadLabel` needs `auth` threaded in, and the existing `select` must also fetch `assigned_to, branch_id`.

**An out-of-scope lead must return the same `notFound: true` as a nonexistent one.** Do not distinguish them — a distinct "no permission" response confirms the lead exists, which is the leak in a thinner form.

⚠️ `fetchLeadLabel` is also called from `resolveUndoAction` for the action's target lead. Scope that call too. If a user somehow references an action on a lead outside their scope, the lead label must be `NOT FOUND`, not the real name.

---

## Finding 2 — undo resolution isn't user-scoped, and contradicts itself

Inside `resolveUndoAction`, the two lookup paths disagree:

- **no id** (most-recent fallback) → `.eq("user_id", auth.userId)` ✓
- **explicit id** → `.eq("id", id)`, **no user filter** ✗

`undo-lead-action.ts:65` refuses to execute another user's action (`target.user_id !== auth.userId`), but the resolver renders the preview *before* that check ever runs. So user A can resolve user B's action id and get back `"Undo: stage change on Riya Sharma (ADM-001), Pre-qualified → Qualified, 5 minutes ago"`. The undo is correctly refused; the content already leaked.

### Do

Add `.eq("user_id", auth.userId)` to the by-id branch, so both paths agree and the resolver matches what the tool will actually permit. A non-owned action id resolves to `notFound: true`.

**Principle worth carrying forward:** the preview must never reveal more than the action would. If the tool would refuse it, the card must not describe it.

---

## Tests

- **Counselor + out-of-scope lead id → `notFound`.** This is the test that matters; write it first.
- Counselor + in-scope lead id (ADM-009..ADM-014 in the local seed) → resolves normally.
- Admin/owner → unchanged; full tenant visibility preserved.
- Out-of-scope lead and nonexistent lead produce **byte-identical** responses.
- Undo by id owned by another user → `notFound`; owned by the caller → resolves.
- Undo whose target lead is out of the caller's scope → lead label is NOT FOUND, rest of the sentence intact.
- Existing 4D tests still pass (there are real ones now — 46 of them).

The local seed supports all of this directly: `counselor@admizz.local` holds ADM-009..ADM-014, the other 24 are unassigned.

## Gates

```bash
rm -rf .next && NODE_OPTIONS=--max-old-space-size=6144 npm run build
npx vitest run          # baseline 442
npm run lint            # 0 errors; no new warnings over the 46 baseline
NODE_OPTIONS=--max-old-space-size=6144 npx tsc --noEmit
```

## Live verification (local)

1. As `counselor@admizz.local` / `edgexdev123`, call the resolver directly with a lead id **outside** ADM-009..ADM-014 → `notFound`. Then with one **inside** → resolves. Show both responses.
2. As `admin@admizz.local`, the same out-of-scope id → resolves (admins are unrestricted). This proves the fix scopes rather than just blanket-denying.
3. Undo: resolve an action id created by the admin while logged in as the counselor → `notFound`.

## Still owed from the original 4D brief

**Browser screenshots of the rendered card** — nobody has visually confirmed it yet. If a screenshot tool is genuinely unavailable in your environment, say so plainly again rather than substituting; Sadin will do the click-through manually. The substitution you made last time was the right call and honestly reported.

## Rules

- Stop at review. **No commit, no push, no PR.**
- No migration — read-side only.
- If either finding is wrong on inspection, **say so and stop** rather than working around it.
