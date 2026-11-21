# BRIEF — Inbox branch-manager scoping fix

**For:** Sonnet executor session
**From:** Opus planning session, 2026-08-16
**Parent plan:** `docs/WHATSAPP-ADMIZZ-PHASE0-BRIEF.md` (this is D1, split out as its own PR)
**Branch from:** latest `origin/stage`
**Stop at the PR.** No merge, no flag flips, no stage/prod DB writes.

---

## 1. The bug

All four inbox conversation routes gate on `auth.role` instead of on the caller's resolved lead
visibility:

```ts
if (auth.role === "counselor") { /* filter to leads assigned to them */ }
// everyone else falls through → tenant-wide
```

That is correct for counselors (`own`) and for owner/admin (`all`). It is **wrong for a branch
manager** (`permissions.leadScope === "team"`), who falls into the `else` and therefore sees
**every conversation in the tenant, across every branch** — while the same user's `/leads`,
`/applications`, `/pipeline` and `/dashboard` views are all correctly branch-scoped.

Affected files (the same block is duplicated in each):

| Route | File |
|---|---|
| list | `src/app/(main)/api/v1/inbox/conversations/route.ts` |
| get + PATCH | `src/app/(main)/api/v1/inbox/conversations/[id]/route.ts` |
| messages GET/POST | `src/app/(main)/api/v1/inbox/conversations/[id]/messages/route.ts` |
| draft approve | `src/app/(main)/api/v1/inbox/conversations/[id]/draft/route.ts` |

**Live impact today is limited but real**: Admizz has active branch managers, and prod carries
Admizz inbox conversations (currently sandbox/demo rows). It becomes a genuine cross-branch data
exposure the moment real WhatsApp traffic starts — which is why this lands *before* the WhatsApp
go-live, not after.

The `/inbox` **page** (`src/app/(main)/(dashboard)/inbox/page.tsx`) does its own unscoped
server-side fetch of conversations too — fix it the same way, or it will keep serving the
unscoped first page regardless of what the API does.

---

## 2. Do not invent a new scoping mechanism — adopt the existing one

The codebase already has exactly the right primitive, and every other lead surface uses it. The
inbox simply never adopted it.

| Piece | Where | What it does |
|---|---|---|
| `leadQueryScope(permissions, userId, branchId, poolSlug?)` | `src/lib/api/permissions.ts:182` | Turns resolved permissions into a scope object. Handles the §4.1 guard: `team` scope with **no** `branchId` falls back to own-only, never to `all`. |
| `visibleLeadsBase({user, service}, tenantId, scope, rpcOpts?)` | `src/lib/leads/visibility-query.ts:37` | Returns a visibility-scoped base query: `own` → `leads_visible_to_user(p_scope:'own')`, `branch` → `…(p_scope:'branch')`, unrestricted → plain tenant select. Throws if `restrictToSelf` is passed without `userId` (fails closed). |
| `requireLeadAccess(auth, lead, membership)` | `src/lib/api/auth.ts:244` | Single-lead access check. Already handles `own` / `team` (branch roster, direct `branch_id`, or branch-member assignee) / `all`. |
| `getLeadMembership(...)` | `src/lib/leads/branch-membership.ts:86` | Loads the `lead_branches` membership rows `requireLeadAccess` needs. |

`GET /api/v1/leads` (`src/app/(main)/api/v1/leads/route.ts:313`) is the reference call site for
`leadQueryScope`. Sadin's SMS audience resolver (`src/lib/sms/audience.ts`, merged to stage
2026-08-15) is the most recent precedent for resolving a recipient set through the caller's own
visibility — same principle, same primitives. Follow those, don't re-derive.

**Note:** `visibleLeadsBase` needs **both** an RLS-context client (`createClient()`) and a service
client (`createServiceClient()`). The inbox routes currently only build a service client — you'll
need to add the user-context one. The RPC branches are `SECURITY DEFINER` and **fail closed to zero
rows** if handed a service-role client with no real `auth.uid()`, so getting this wrong produces a
silent empty inbox, not an error. Verify against a real logged-in session, not curl with a service key.

---

## 3. The fix, in two shapes

### 3a. The three single-conversation routes — use `requireLeadAccess`

`[id]/route.ts` (GET + PATCH), `[id]/messages/route.ts`, `[id]/draft/route.ts` each already load
the conversation and therefore have exactly one `lead_id`. Replace the `role === "counselor"` block
with: load the lead + its membership, call `requireLeadAccess(auth, lead, membership)`, 404/403 on
false. No set logic needed.

Keep the existing behavior for a conversation with **`lead_id IS NULL`** (unlinked inbound). Today
a counselor cannot see unlinked conversations — that is a deliberate product choice recorded in
`docs/UNIFIED-INBOX-BRIEF.md` ("Counselors don't see *unlinked* conversations… revisit if
counselors should pick up fresh inbound directly"). **Do not change that behavior in this PR** —
apply the same rule to branch managers (no lead ⇒ no scoped access; owner/admin still see them)
and note it in the PR so the product call can be revisited separately.

### 3b. The list route — scope by the leads that conversations actually reference

The obvious implementation (resolve every visible lead, then `.in("lead_id", allIds)`) **must not
be used.** Admizz has 16,684 leads; a branch's slice is still thousands, and PostgREST puts `.in()`
values in the URL. The codebase has already hit `UND_ERR_HEADERS_OVERFLOW` doing exactly this —
see the warning comment on `sharedBranchLeadIdsForAssignee`
(`src/lib/leads/branch-membership.ts:56-58`).

**Use the bounded set instead.** The distinct `lead_id`s referenced by a tenant's conversations is
bounded by *conversation* count, not lead count — small, and it stays small. So:

1. Collect the distinct non-null `lead_id`s across the tenant's conversations (apply the request's
   existing `status` / `channel_id` filters first so the set is as small as possible).
2. Intersect that set with what the caller may see — query `visibleLeadsBase(...)` restricted to
   those ids (`.in("id", thatSmallSet)`).
3. Filter the conversation query with `.in("lead_id", intersection)`.

This keeps pagination correct (the filter is applied *before* the page is taken, not after) and
keeps every URL bounded. If you find a cleaner formulation, take it — but the two hard requirements
are **pagination stays correct** and **no unbounded id list ever goes into a URL**.

### 3c. Extract one helper, don't duplicate it a fifth time

Put the shared logic in a new `src/lib/inbox/scope.ts` so the four routes plus the page component
call one function. The duplication of this block across 4 files is what let the gap persist —
don't preserve that shape.

---

## 4. Out of scope

- **No attachment work** — that's the separate D2/D3 PR (`docs/WHATSAPP-ADMIZZ-PHASE0-BRIEF.md`).
- **No migration.** If you think you need one, stop and say so in your report instead of writing one.
- No WhatsApp/Meta/env changes, no template work, no AI/agent wiring.
- No change to counselor or owner/admin behavior — this PR only *adds* correct handling for the
  `team` scope. Counselor and admin behavior must be provably identical before and after.

---

## 5. Verification

1. `npm run build`, `npx eslint --max-warnings 50`, `npm run test` — all green.
2. **Scoping matrix, verified as a real logged-in user** (not a service-role curl — the RPC path
   fails closed without a real JWT and would give a false "empty is correct" reading):

   | Role | Expected on `/inbox` list | Expected on a conversation in *another* branch |
   |---|---|---|
   | owner / admin | all tenant conversations (unchanged) | accessible |
   | branch manager (`leadScope:"team"`, has `branchId`) | **only their branch's** | **404/403** |
   | branch manager with **NULL** `branchId` | own-only (§4.1 fallback — must NOT widen to all) | 404/403 |
   | counselor | own assigned leads only (unchanged) | 404/403 |

3. Prove **list and detail agree** — the exact bug class the leads routes guard against. For each
   role, every conversation visible in the list must open successfully, and anything not in the
   list must 404/403 on direct URL. No "list shows it, detail 404s" and no reverse.
4. Confirm the same scoping applies on the server-rendered `/inbox` page, not just the API.
5. Regression: unlinked (`lead_id IS NULL`) conversations behave exactly as before for counselors.

---

## 6. Report back

What you changed, the scoping-matrix results, and anything in §3b that turned out to be the wrong
shape in practice. Flag explicitly if the bounded-set approach had to change — that's the one
design call in this brief most likely to need adjusting against real data.

---

## SONNET HANDOFF PROMPT

> Fix inbox branch-manager scoping per `docs/INBOX-BRANCH-SCOPE-BRIEF.md`. Branch from latest `origin/stage`.
>
> **Bug:** the four inbox conversation routes (`src/app/(main)/api/v1/inbox/conversations/route.ts`, `[id]/route.ts`, `[id]/messages/route.ts`, `[id]/draft/route.ts`) each hand-roll `if (auth.role === "counselor")` and have no handling for `permissions.leadScope === "team"` — so a **branch manager sees every conversation tenant-wide**, unlike their correctly-scoped `/leads` and `/applications` views. The server-rendered `/inbox` page (`src/app/(main)/(dashboard)/inbox/page.tsx`) has the same unscoped fetch and needs the same fix.
>
> **Fix:** adopt the primitives the rest of the app already uses — `leadQueryScope()` (`src/lib/api/permissions.ts:182`) + `visibleLeadsBase()` (`src/lib/leads/visibility-query.ts:37`), with `GET /api/v1/leads` (route.ts:313) and `src/lib/sms/audience.ts` as reference call sites. For the three single-conversation routes, just use the existing `requireLeadAccess()` (`src/lib/api/auth.ts:244`) + `getLeadMembership()` — one lead each, no set logic. For the list route, scope by the distinct `lead_id`s referenced by conversations (bounded by conversation count) intersected with visible leads — **do NOT** resolve all visible leads and `.in()` them; Admizz has 16k leads and that hits `UND_ERR_HEADERS_OVERFLOW` (see the comment at `src/lib/leads/branch-membership.ts:56`). Pagination must stay correct and no unbounded id list may go into a URL. Extract one shared helper (`src/lib/inbox/scope.ts`) instead of duplicating the block a fifth time.
>
> **Note:** `visibleLeadsBase` needs both a `createClient()` (RLS context) and a `createServiceClient()`; the inbox routes only build the latter today. The RPC branches fail closed to zero rows without a real `auth.uid()`, so verify as a real logged-in user, not a service-role curl.
>
> **Do NOT** touch attachments, write a migration, or change counselor/owner/admin behavior — this only *adds* correct `team`-scope handling. Leave unlinked (`lead_id IS NULL`) conversation behavior exactly as-is and note it in the PR.
>
> Verify per §5: build + eslint + test green, the full role×branch scoping matrix as a real logged-in user, and prove list and detail agree in both directions. Commit trailer `Co-Authored-By: Claude Opus 4.8 (1M context) <noreply@anthropic.com>`. Then STOP and summarize for review — no merge, no flags, no DB writes.
