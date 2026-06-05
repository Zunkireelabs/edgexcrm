# Lead Dedup — Phase B1 Fix-Up Brief (revise before B2/B3/backfill)

**Context:** Opus reviewed the B1 delivery (`src/lib/leads/merge.ts`, `POST /api/v1/leads/merge`, `POST /api/v1/leads/merge/[mergeId]/undo`, `supabase/migrations/034_lead_merge_undo.sql`). CI gates pass (build clean, eslint 24 warn / 0 err). The merge path is structurally sound, **but the review found four issues that must be fixed before the synthetic test, before B2, and absolutely before any backfill apply.** Finding #1 breaks the "fully reversible / no data loss" hard rule.

**Workflow reminder:** commits on `feat/lead-dedup-phase-b` only (NOT stage). Migrations on a LOCAL/throwaway DB only — do NOT apply 034 or create the unique index on the shared Supabase DB. **STOP after the fixes + the synthetic round-trip test below.** Report back with the diff; Opus re-reviews.

---

## 🔴 #1 (BLOCKER) — `undoMerge` destroys canonical's `custom_fields`, `file_urls`, `tags`

**Bug:** `field_patch` stores only the *new* (post-merge) value per key. `undoMerge` reverts every patched key to `null` (`merge.ts:479-486`). That's correct for scalars (they were empty pre-merge), but `applyCanonicalUpdate` patches the JSONB/array fields with a **merge that includes canonical's own data** (`dedup.ts:149` custom_fields, `:157` file_urls, `:165` tags union). So undo nulls out the surviving lead's real custom fields, uploaded files, and original tags. Not reversible → violates the hard rule.

**Fix — store `{old, new}` per key and restore `old`:**

In `mergeLeads`, after computing `fieldPatch` (the flat new-values object from `applyCanonicalUpdate`), build a detailed patch capturing canonical's pre-merge value for each key, and persist THAT to `lead_merges.field_patch`:

```ts
// after: const fieldPatch = applyCanonicalUpdate(canonical, {...});
const fieldPatchDetailed: Record<string, { old: unknown; new: unknown }> = {};
for (const key of Object.keys(fieldPatch)) {
  fieldPatchDetailed[key] = {
    old: (canonical as Record<string, unknown>)[key] ?? null,
    new: fieldPatch[key],
  };
}
// apply still uses the flat new values:
if (Object.keys(fieldPatch).length > 0) {
  await supabase.from("leads").update(fieldPatch).eq("id", canonicalId).eq("tenant_id", tenantId);
}
// store the detailed shape:
//   ...insert lead_merges({ ..., field_patch: fieldPatchDetailed, ... })
```

In `undoMerge`, restore `old` instead of null, keeping the "only revert if value still matches what we set" guard so post-merge manual edits aren't clobbered:

```ts
const fp = m.field_patch as Record<string, { old: unknown; new: unknown }>;
const revert: Record<string, unknown> = {};
for (const key of Object.keys(fp)) {
  const current = (currentCanonical as Record<string, unknown>)[key];
  if (JSON.stringify(current) === JSON.stringify(fp[key].new)) {
    revert[key] = fp[key].old;   // restore original, NOT null
  }
}
if (Object.keys(revert).length > 0) {
  await supabase.from("leads").update(revert).eq("id", canonicalId).eq("tenant_id", tenantId);
}
```

`m.field_patch` type annotation in `undoMerge` changes from `Record<string, unknown>` to `Record<string, { old: unknown; new: unknown }>`.

---

## 🟠 #2 — `undoMerge` has no tenant check (cross-tenant undo)

`undoMerge` loads the merge by `mergeId` alone and never compares `m.tenant_id` to the caller's tenant. An admin of tenant A could undo tenant B's merge by supplying B's `mergeId`. (The merge POST is safe — it validates both leads belong to `auth.tenantId`.)

**Fix:** thread `tenantId` into `undoMerge` and treat a mismatch as not-found (don't leak existence):

```ts
export async function undoMerge(
  supabase: SupabaseServiceClient,
  mergeId: string,
  tenantId: string,            // NEW — required
  undoneBy?: string | null,
  requestId?: string
): Promise<UndoMergeResult> {
  // ...after loading m:
  if (!merge || (merge as { tenant_id: string }).tenant_id !== tenantId) {
    throw new Error(`undoMerge: merge record ${mergeId} not found`);
  }
```

Route (`[mergeId]/undo/route.ts:34`): `await undoMerge(supabase, mergeId, auth.tenantId, auth.userId, requestId)`. The existing `"not found"` → `apiValidationError` mapping already covers it.

---

## 🟠 #3 — `lead_duplicate_suggestions` FK left dangling on merge

Both `lead_duplicate_suggestions.lead_id` and `.suggested_lead_id` reference `leads(id)` (confirmed via FK enumeration) and `mergeLeads` re-points neither. Empty today, but **B2 fills this table** — after a merge, suggestions pointing at the absorbed (soft-deleted) lead would dangle and the "possible duplicates" card would surface stale/merged pairs.

**Fix — treat like `lead_insights` (regenerable, delete-not-restore).** Suggestions are derived phone-match candidates, not user data. In `mergeLeads`, after the other re-points, delete any suggestion referencing the absorbed lead in either column and record the count:

```ts
{
  const { data } = await supabase
    .from("lead_duplicate_suggestions")
    .delete()
    .or(`lead_id.eq.${absorbedId},suggested_lead_id.eq.${absorbedId}`)
    .select("id");
  repointedCounts.lead_duplicate_suggestions_deleted = ids(data).length;
}
```

Do **not** restore these on undo (same rationale as the existing `lead_insights_deleted` case — regenerable). Leave a one-line comment saying so.

---

## 🟡 #4 (DECISION NEEDED — flag, don't guess) — merge is non-atomic; `lead_merges` row written last

`mergeLeads` is ~12 sequential writes with no transaction, and the `lead_merges` row — the only thing that makes a merge undoable — is inserted **last** (`merge.ts:271`), after all FK re-pointing and the soft-delete. A failure partway leaves children moved onto canonical with **no merge record** → un-undoable. Low risk for a manual one-off (admin retries); real risk for the **unattended backfill across ~24 email groups** (B3).

**Two options — DO NOT pick unilaterally; implement the fallback and flag the RPC question for Opus/Sadin:**

- **(A) Gold standard:** port the merge core to a single Postgres `plpgsql` function `merge_leads(...)` invoked via `supabase.rpc()` → true atomicity. Larger change, SQL/TS logic duplication, heavier review.
- **(B) Pragmatic fallback (implement this for now):** insert the `lead_merges` row **first** (empty `repointed_ids`/`repointed_counts`/`field_patch`), capture `mergeId`, do the re-pointing + soft-delete, then `UPDATE lead_merges SET repointed_ids=..., repointed_counts=..., field_patch=..., synthesized_submission_id=... WHERE id=mergeId`. A partial failure then always leaves a durable, inspectable merge record. This is mitigation, not true atomicity.

Implement (B). Add a `// TODO(atomicity): consider plpgsql RPC — see B1 fixup brief #4` comment so the RPC decision stays visible for the backfill phase.

---

## Synthetic local round-trip test (REQUIRED — this is what would have caught #1)

Apply `034_lead_merge_undo.sql` to a **local/throwaway** DB (all statements except the commented index). Start `npm run dev`. On the Zunkiree Labs tenant `a0000000-0000-0000-0000-000000000001` (never customer data):

1. Create two synthetic leads. **Give the *canonical* lead non-empty `custom_fields` (e.g. `{"a":1}`), `tags` (e.g. `["keep"]`), and a `file_urls` entry.** Give the *absorbed* lead different `custom_fields`/`tags` so the merge produces a real union/merge patch.
2. Add a note + an activity to each lead.
3. `POST /api/v1/leads/merge { canonical_id, absorbed_id }`. Assert: absorbed `deleted_at` + `merged_into` set; notes/activities now on canonical; `lead_merges` row exists with `field_patch` in `{old,new}` shape; canonical's `custom_fields`/`tags`/`file_urls` are the merged superset.
4. `POST /api/v1/leads/merge/<mergeId>/undo`. **Assert the round-trip is lossless:** absorbed restored (`deleted_at`/`merged_into` null), notes/activities back on absorbed, synthesized submission deleted, `lead_merges.undone_at` set, **and canonical's `custom_fields` == `{"a":1}`, `tags` == `["keep"]`, `file_urls` == its original entry** (NOT null — this is the #1 regression check).
5. Cross-tenant check (#2): confirm undo of a merge with a mismatched tenant id is rejected as not-found.

Report the diff + test results. Do not commit to stage, do not touch the shared DB, do not run the backfill.
