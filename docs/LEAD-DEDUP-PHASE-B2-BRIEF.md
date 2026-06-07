# Lead Dedup — Phase B2 Brief (merge UI + duplicate suggestions)

> **Executor:** Sonnet. **Reviewer:** Opus (Sadin pastes the handoff prompt below).
> **Branch:** `feat/lead-dedup-phase-b` (continue — B1 + fixups already on it). **Not** stage.
> **Prereq:** B1 merge engine is reviewed + on the branch (`mergeLeads`/`undoMerge` in
> `src/lib/leads/merge.ts`, `POST /api/v1/leads/merge`, `.../[mergeId]/undo`). Schema from
> migration `033` exists on shared (`lead_duplicate_suggestions`). **No new migration in B2.**

## Why

B1 gave us the merge primitive + admin API. B2 makes it usable: (1) persist the
phone-match candidates Phase A already computes but throws away, and (2) give admins a
merge dialog + a "Possible duplicates" surface to act on them. B3 (the bulk backfill) is a
**separate later step — do NOT build it here.**

## HARD RULES

1. **Suggestion persistence must be non-fatal.** Wrap every suggestion write in try/catch —
   it must NEVER break or slow lead ingestion. Ingestion success does not depend on it.
2. **Admin-gate every mutation.** Merge + dismiss are admin-only (`requireAdmin(auth)` →
   `apiForbidden()`), same as the B1 merge route. Viewing suggestions is tenant-member (RLS).
3. **Local/synthetic test only, Zunkiree Labs tenant** (`a0000000-0000-0000-0000-000000000001`),
   never customer (Admizz) data. Clean up test rows after — and this time, **verify the
   cleanup actually deleted them** (B1's test left orphan leads because it didn't check the
   delete result).
4. **Stop at review.** Commit on the branch, run both CI gates, report. Do NOT start B3, do
   NOT run any backfill, do NOT touch the shared DB schema.

---

## Part 1 — Persist phone duplicate suggestions (wire the A3 paths)

Phase A's `resolveLeadIdentity` (`src/lib/leads/dedup.ts`) returns `phoneMatchLeadIds` only
in the **no-email-match** branch (a brand-new lead that shares a phone suffix with existing
leads). Today all three ingestion paths ignore it. Persist it.

**Add a helper to `dedup.ts`:**

```ts
// Upserts open phone-duplicate suggestions. Non-fatal; caller wraps in try/catch.
// onConflict DO NOTHING so a previously dismissed pair never resurfaces.
export async function recordDuplicateSuggestions(
  supabase: SupabaseServiceClient,
  params: { tenantId: string; leadId: string; suggestedLeadIds: string[]; reason: "phone" | "name" }
): Promise<void> {
  const rows = params.suggestedLeadIds
    .filter((sid) => sid !== params.leadId)          // never self-suggest
    .map((sid) => ({
      tenant_id: params.tenantId,
      lead_id: params.leadId,
      suggested_lead_id: sid,
      reason: params.reason,
      status: "open",
    }));
  if (rows.length === 0) return;
  await supabase
    .from("lead_duplicate_suggestions")
    .upsert(rows, { onConflict: "tenant_id,lead_id,suggested_lead_id", ignoreDuplicates: true });
}
```

**Call it in all three create-paths**, after the new lead row is inserted and you have its
id, using the `phoneMatchLeadIds` from that path's `resolveLeadIdentity` result. Wrap in
`try { ... } catch { /* non-fatal */ }`:

- `src/app/(main)/api/v1/leads/route.ts` — the `match === "none"` create branch (~line 530+).
- `src/app/api/public/submit/[tenantSlug]/[formSlug]/route.ts` — the equivalent create branch.
- `src/app/(main)/api/v1/integrations/crm/leads/route.ts` — same.

(Only the no-email-match create branch — the email-match branch returns `phoneMatchLeadIds: []`.)

## Part 2 — Read + dismiss APIs

- **`GET /api/v1/leads/[id]/duplicates`** — `authenticateRequest()`, then return **open**
  suggestions touching this lead in **either** direction
  (`lead_id = id OR suggested_lead_id = id`, `status = 'open'`), each enriched with the
  *other* lead's `id, first_name, last_name, email, phone, created_at` for display. Filter to
  `auth.tenantId`. Counselor scoping: a counselor only sees suggestions where the *other*
  lead is one of theirs — simplest is to gate the whole card to admins (see Part 4) and skip
  counselor logic; confirm with Opus if unsure.
- **`PATCH /api/v1/leads/duplicates/[suggestionId]`** (or `POST .../dismiss`) — `requireAdmin`,
  load the suggestion, **verify `tenant_id === auth.tenantId` (treat mismatch as 404)**, set
  `status = 'dismissed'`. Returns 200.

> Note: you do NOT need a "mark merged" endpoint — B1's `mergeLeads` already **deletes**
> `lead_duplicate_suggestions` rows referencing the absorbed lead, so a successful merge
> clears the prompting suggestion automatically. Dismiss is only for the "not a duplicate" case.

## Part 3 — Merge dialog component

`src/components/dashboard/lead/merge-dialog.tsx` (shadcn `Dialog` + `Button` + `RadioGroup`):

- Props: the two lead objects (or two ids → fetch). Side-by-side **field diff** of
  `first_name, last_name, email, phone, city, country, tags, key custom_fields`.
- Radio to choose **canonical** (default = older `created_at`); the other becomes absorbed.
- A short "what happens" note: "The other record's notes, activities, tasks, emails, and
  submissions move to the kept lead. The absorbed lead is archived and can be restored."
- "Merge" → `POST /api/v1/leads/merge { canonical_id, absorbed_id }`; on success toast +
  refresh (router.refresh / revalidate the list + detail). Handle the 400 validation errors
  from B1 (converted lead, already deleted) with a readable toast.

## Part 4 — Entry points

- **Lead detail** (`src/components/dashboard/lead/lead-detail-v2.tsx` / `lead-tabs.tsx`): add a
  **"Possible duplicates"** card or tab that calls `GET /api/v1/leads/[id]/duplicates`. For
  each suggestion show the other lead's name/email/phone + **"Merge"** (opens the dialog
  prefilled with this pair) and **"Dismiss"**. Show the card only when there is ≥1 open
  suggestion. Gate Merge/Dismiss to admins (`role` owner/admin); non-admins see the list
  read-only (or hide entirely — confirm with Opus, default: hide for non-admins).
- **Leads table** (`src/components/dashboard/leads-table.tsx`): it already tracks
  `selectedIds: Set<string>`. When **exactly 2** are selected, show a **"Merge"** bulk action
  that opens the dialog with those two leads. Hide the action for non-admins.

## Verification (LOCAL, synthetic, Zunkiree Labs tenant)

1. `npm run dev`. Create 2+ synthetic leads on tenant `a0000000-…-0001` that share a phone
   suffix but have different emails (so no auto-merge, and a phone suggestion is generated).
   Confirm a `lead_duplicate_suggestions` row appears (`reason='phone'`, `status='open'`).
2. Open the newer lead's detail → "Possible duplicates" card shows the other → click **Merge**
   → choose canonical → confirm the merge happened (absorbed archived, children moved) and the
   suggestion is gone.
3. Create another suggestion pair → **Dismiss** → confirm `status='dismissed'` and it no
   longer shows; re-submit the same lead → confirm the dismissed pair does NOT resurface
   (onConflict DO NOTHING).
4. Leads table: select exactly 2 → **Merge** action appears → works.
5. **Delete all synthetic test rows and verify the deletes succeeded** (re-query → 0 rows).

CI gates: `npm run build` clean + `npx eslint --max-warnings 50` (0 errors). After adding
route segments, `rm -rf .next` before re-running dev.

## Sonnet handoff prompt

> Continue Phase B of the lead-dedup work on branch `feat/lead-dedup-phase-b` — implement
> **B2 only** per `docs/LEAD-DEDUP-PHASE-B2-BRIEF.md`. Do NOT build B3 (the backfill) or touch
> the shared DB schema. In order: (1) add `recordDuplicateSuggestions` to `src/lib/leads/dedup.ts`
> and call it (wrapped in try/catch, non-fatal) in the no-email-match create branch of all
> three ingestion paths (`api/v1/leads/route.ts`, `api/public/submit/[tenantSlug]/[formSlug]/route.ts`,
> `api/v1/integrations/crm/leads/route.ts`), persisting `phoneMatchLeadIds` as open `reason='phone'`
> suggestions with onConflict DO NOTHING; (2) `GET /api/v1/leads/[id]/duplicates` (open
> suggestions both directions, enriched with the other lead's fields) and an admin-gated
> dismiss route with a tenant check; (3) `src/components/dashboard/lead/merge-dialog.tsx`
> (field diff + choose canonical default-older + POST `/api/v1/leads/merge`); (4) a "Possible
> duplicates" card in `lead-detail-v2.tsx`/`lead-tabs.tsx` and a 2-selected "Merge" bulk
> action in `leads-table.tsx`. Admin-gate all mutations. Reuse the B1 merge API, shadcn
> Dialog/Button, existing toast + router.refresh patterns. Test on SYNTHETIC leads in the
> Zunkiree Labs tenant `a0000000-0000-0000-0000-000000000001` only (never Admizz), and
> **verify your cleanup deletes actually succeeded** (re-query → 0). Run both CI gates
> (`npm run build` clean + `npx eslint --max-warnings 50`). Keep commits on the branch, stop
> at review, report what changed + test results.
