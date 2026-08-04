---
name: hardik-login
description: Session initialization skill for Hardik. Reads all critical project docs and outputs a structured briefing — current state, open blockers, next task, migration state, and key non-negotiables. Run at the start of every session before any work begins.
---

# Hardik Login — Session Initializer

You are initializing a new working session for Hardik on the EdgeX CRM project (Zunkiree Labs). Your job is to read the docs listed below and produce a clean, structured session briefing. Do not start any work until the briefing is complete.

---

## STEP 1 — Read these files in order

Read all four files fully before writing the briefing:

1. **`docs/dev-collab/DEV-WORKFLOW-AND-DEPLOYMENT.md`** — The non-negotiable SOP. Branch rules, migration protocol, PR discipline, rollback, the 11 rules. Extract the top rules that are most likely to trip up this session.

2. **`docs/SESSION-LOG.md`** — Focus on the `## 🟢 NEXT SESSION — RESUME HERE` block at the top. That is where we left off. Pull: last shipped item, current prod state, next free migration number, any pending unresolved items.

3. **`docs/STATUS-BOARD.md`** — Pull all `[ ]` unchecked items under `## 🔴 Needs Sadin decision / action`. These are open blockers. Skip `[x]` completed items.

4. **`docs/FEATURE-ROADMAP.md`** — Pull what is in `## 🟡 In Progress` or `## 🟢 Approved for dev` that hasn't shipped yet. That is the candidate for today's work.

**Also know about (do NOT read unless relevant to today's session):**
- `docs/dev-collab/LOCAL-DEV-SETUP.md` — surface this if the session involves local DB setup, running migrations locally, or environment troubleshooting.
- `docs/dev-collab/README.md` — just an index, skip.

---

## STEP 2 — Output the session briefing in this exact format

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  EDGEX CRM — SESSION BRIEFING
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

📍 PROJECT STATE
   Live:        <prod URL from SESSION-LOG>
   Repo:        Zunkireelabs/edgexcrm
   Last shipped: <most recent shipped item — one line>
   Prod status:  <0 pending migrations / any known prod issues>

⚡ KEY NON-NEGOTIABLES (from the SOP — never skip these)
   1. Branch from + rebase onto latest `origin/stage` before merge.
      If GitHub says "out-of-date" → click Update Branch first.
   2. Migrations go DB-first. Apply to stage → verify → apply to prod
      BEFORE the code merges to `main`. (main auto-deploys, no migration step.)
   3. Everything is a PR. No direct pushes to `stage` or `main`.
      Feature PRs → stage (squash-merge). stage → main (merge commit, 1 approval).
   4. Next free migration number: <from SESSION-LOG>

🔴 OPEN BLOCKERS (need Sadin's decision/action)
   <List each [ ] item from STATUS-BOARD § Needs Sadin decision, as bullet points.>
   <Keep each to one line. If there are none, write "None — all clear.">

🏗️  NEXT TASK
   <What is in-progress or next approved on the FEATURE-ROADMAP.>
   <One paragraph max. If multiple candidates, list them ranked.>

🗂️  MIGRATION STATE
   Next free migration number: <NNN>
   Pending on stage (not prod): <any known stage-only migrations from STATUS-BOARD>
   Pending on prod:             <any known prod-pending items>

✅ SESSION LOADED
   Ready to work. What are we building today?
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

---

## STEP 3 — After the briefing, ask one question

Ask: **"What are we working on today?"** — then wait for Hardik's response before doing anything else.

If Hardik says a feature name or task, match it against the ROADMAP and STATUS-BOARD context you just read. If it's a new idea not on the ROADMAP, classify it (Global / Industry-aware / Industry-scoped per CLAUDE.md rules) before proceeding.

---

## Rules for this skill

- Read all four docs completely before writing the briefing. Do not guess or recall from memory — always read the actual files.
- Keep the briefing tight. One line per blocker. No paragraphs in the blockers section.
- If SESSION-LOG's resume block references a brief file (e.g. `docs/FOO-BRIEF.md`), note it in NEXT TASK but do not read it during the login — wait until Hardik confirms that's today's work.
- If `LOCAL-DEV-SETUP.md` is relevant (Hardik mentions local DB, supabase start, migration testing), reference it explicitly: "See `docs/dev-collab/LOCAL-DEV-SETUP.md` for setup commands."
- This skill does not start any implementation. It only briefs and asks what to work on.
