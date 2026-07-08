# docs/dev-collab — how this team ships without breaking prod

Process & collaboration home. If you're a developer (or an AI/Claude session) working on this repo, **read this folder before you branch, migrate, or deploy.** Most "my feature got reverted on prod" and "prod is 500ing" incidents come from skipping one rule in here.

| Doc | What it's for |
|---|---|
| [`DEV-WORKFLOW-AND-DEPLOYMENT.md`](./DEV-WORKFLOW-AND-DEPLOYMENT.md) | **The SOP.** Branch discipline, the migration protocol (apply-to-prod-before-code), promotion & rollback runbooks, shared-file conflict rules, team collaboration norms, and copy-paste checklists. Authoritative. |
| [`LOCAL-DEV-SETUP.md`](./LOCAL-DEV-SETUP.md) | **New dev? Start here.** Stand up an isolated local database (OrbStack + Supabase) in ~15 min, daily-use commands, how to test a migration locally, and why local baselines its schema instead of replaying history. |
| [`../../.github/pull_request_template.md`](../../.github/pull_request_template.md) | The checklist that auto-fills every PR — enforces the same rules at PR time. |

**⚡ These rules are now ENFORCED** — `main` and `stage` are branch-protected (as of 2026-07-06). You can't push to them directly, your PR must be up to date before it merges, CI must pass, and feature PRs squash-merge into `stage`. See **§ "What changed"** at the top of the SOP for exactly how your day-to-day works now (and what to tell your Claude session).

**Start here — the 10 non-negotiables** are in § 0 of the SOP. The two that prevent almost every production incident:

1. **Branch from — and rebase onto — the latest `origin/stage`** before you merge; if GitHub says "out-of-date," click **Update branch** (prevents silently reverting a teammate's work on a shared file).
2. **Apply a migration to the prod DB *before* the code that needs it merges to `main`** (`main` auto-deploys with no migration step → otherwise prod runs new code on an old schema → 500s).

This folder is living. When the pipeline changes or a new failure mode bites us, update the SOP here first.
