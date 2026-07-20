# BRIEF — Merge step 1: rebase `feature/ai-phase-4-writes` onto stage + PR

**Branch:** `feature/ai-phase-4-writes` (currently `b0029d5`, 14 commits, ~11 behind stage). Tree must be clean before you start.

This is the first of **two** merges. **Do not touch the other two branches** (`feature/ai-per-tenant-flag`, `feature/ai-langfuse-masking`) — they get combined into a single second PR after this one lands and stage is verified.

This branch merges alone deliberately: it carries the silent revert described below, ~68 files, and 2 migrations. It needs to be reviewable on its own and revertible on its own. The other two are 25 files and 1 migration between them, overlapping only in different regions of `chat/route.ts`, so bundling them costs nothing and saves a rebase cycle.

**You may open the PR. You may NOT merge it.** Sadin merges after review.

---

## ⚠️ Read this section before running a single git command

The rebase contains a **silent revert** that will not announce itself. Build will pass, tests will pass, and a fix that shipped to stage twice will be gone.

### What happened

- **Stage** added an admin/branch-manager bypass of the Prospects qualification gate — PRs **#235** (`ebd4abb`) and **#236** (`10c9b15`). It lives in `src/app/(main)/api/v1/leads/[id]/route.ts` as `canBypassProspectQualification(auth.permissions.baseTier, auth.positionSlug)` at lines **30, 595, 763**, and is consumed via `bypassQual` around **786** and **883**.
- **Phase 4B** gutted that same route — 1061 deletions — extracting the whole PATCH body into a **new file**, `src/lib/leads/apply-lead-patch.ts`.
- That extraction was made from the **pre-#235 version**. Its copy of the gate (lines **531/533** and **718**) has **no bypass at all**.

### Why it's dangerous rather than merely annoying

`apply-lead-patch.ts` is **new on this branch and stage has never touched it**, so git will merge it **completely cleanly**. The only conflict appears in `route.ts` — the file where your branch *deleted* the code. Resolve that conflict the natural way (keep your side: the deletion) and stage's bypass is gone, with **no conflict marker anywhere pointing at the file that now holds the stale logic**.

Nothing will catch it: the build compiles, and this branch's tests were written against pre-bypass behavior so they pass. The failure only shows when an owner/admin/branch-manager tries to move an unqualified lead into Prospects — and gets blocked, exactly as they were before someone shipped two PRs to fix it.

This is the "prod features reverting" incident class that `docs/dev-collab/DEV-WORKFLOW-AND-DEPLOYMENT.md` exists to prevent.

### What you must do about it

**Port the bypass into `apply-lead-patch.ts`.** This is a *semantic* merge, not a textual one — nothing git does will produce it for you.

1. Read stage's current `route.ts` and identify **every** site using `canBypassProspectQualification` / `bypassQual`. My count is three logical sites (hard gate ~595, auto-promote qualification ~786, and a third ~883) — **verify that count yourself against stage rather than trusting mine.**
2. Reproduce each one at its corresponding location in `apply-lead-patch.ts` (gate at ~531/533, auto-promote at ~718, plus whatever the third maps to).
3. Confirm `auth.permissions.baseTier` and `auth.positionSlug` are available in `applyLeadPatch`'s scope; thread them if not.
4. Check whether stage's other callers of the qualification gate (`leads/bulk/route.ts`, `leads/route.ts`, `check-in/route.ts`) also changed in those 11 commits and whether this branch touches them.

**If the behavior turns out to already be preserved some other way, say so and stop** — but prove it, don't assume it.

---

## Rebase procedure

```bash
git fetch origin
git switch feature/ai-phase-4-writes
git rebase origin/stage
```

Rebase **immediately before** opening the PR — stage moved twice during this session's work and will keep moving.

**Conflict rule (non-negotiable, from the SOP):** resolve **hunk by hunk**. Never `--ours` / `--theirs` on a whole file, never "keep my whole file." Every conflicted file needs both sides' intent preserved.

Expected conflicts: only `src/app/(main)/api/v1/leads/[id]/route.ts` collides textually with stage. Everything else in this branch's ~68 files touches paths stage didn't. **Report the full conflict list you actually get** — if it's larger than one file, stage moved again and the analysis needs redoing.

## Migrations

`172_ai_write_actions.sql` and `173_ai_write_provenance.sql` ride this PR. Both numbers are confirmed free on stage.

- **They have only ever been applied locally.** Merging to stage triggers the auto-migrate job, which applies them to the stage DB *before* the container swaps.
- Verify both carry their `schema_migrations` self-record line (required by the Migration Guard CI check for anything ≥123).
- Do **not** hand-apply them to stage. The pipeline does it.

## Gates — after the rebase, not before

A green pre-rebase branch proves nothing.

```bash
rm -rf .next && NODE_OPTIONS=--max-old-space-size=6144 npm run build
npx vitest run          # baseline on this branch was 457; report the number and explain any change
npm run lint            # 0 errors; report warning count vs stage's baseline
NODE_OPTIONS=--max-old-space-size=6144 npx tsc --noEmit
```

## Tests you must add

The whole point is that existing tests can't catch the revert:

- **Owner/admin can move an unqualified lead to Prospects through `applyLeadPatch`** (the bypass path). This test must **fail** against the un-ported version — check that it does before you port, so you know it's real.
- A non-bypassing role (counselor) is still blocked by the gate.
- The same for the auto-promote path.

## Live verification (local)

1. As `admin@admizz.local`, move a lead **with no academic fields** into Prospects via the UI. It must succeed — that's the bypass working.
2. As `counselor@admizz.local`, the same move must still be blocked with the qualification message.
3. Confirm the AI write tools still work end to end (the 4C–4F flows) after the rebase.

## PR

```bash
gh pr create --base stage --title "..." --body "..."
```

- Base **must** be `stage`. Verify with `gh pr view <n> --json baseRefName`.
- Body must state: migrations 172 + 173 ride this PR; `AI_WRITE_TOOLS_ENABLED` stays **off** on stage; and call out the ported prospect-qualification bypass explicitly so the reviewer checks it.
- **Do not merge.** Report the PR number and CI status.

## Rules

- Don't touch the other two branches.
- Keep `AI_WRITE_TOOLS_ENABLED` off in every environment.
- If the conflict picture differs from this brief, **say so and stop** — that instruction has caught two bad briefs of mine already.
