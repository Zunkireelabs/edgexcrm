# CI/CD Pipeline Setup — Lead Gen CRM

Complete checklist for setting up GitHub Actions CI/CD with staging and production environments.

**Status**: In Progress
**Created**: 2026-03-15

---

## What's Already Done

- [x] `stage` branch created and pushed to GitHub
- [x] Staging clone created at `/home/zunkireelabs/devprojects/lead-gen-crm-dev/`
- [x] Staging clone checked out to `stage` branch
- [x] Staging `docker-compose.yml` configured (`leads-crm-dev`, `dev-lead-crm.zunkireelabs.com`)
- [x] `.env.local` copied to staging clone
- [x] GitHub Actions workflow files created:
  - `ci.yml` — PR checks on PRs to `stage` or `main`
  - `deploy-staging.yml` — auto-deploy on push to `stage`
  - `deploy.yml` — auto-deploy on push to `main`
  - `rollback.yml` — manual rollback for production
- [x] CI/CD skill created and registered

---

## Prerequisites

- [x] GitHub repo access with admin permissions (`Zunkireelabs/edgexcrm`)
- [x] SSH access to production server (`94.136.189.213`)
- [x] `.env.local` file on server with Supabase keys
- [ ] DNS record: `dev-lead-crm.zunkireelabs.com` → `94.136.189.213` (user confirmed this is done)

---

## Step 1: Generate Deploy SSH Key

The CI/CD pipeline needs its own SSH key to connect to your server.

**On your server** (`94.136.189.213`):

```bash
# Generate a new key pair (no passphrase)
ssh-keygen -t ed25519 -C "github-deploy-lead-crm" -f ~/.ssh/github_deploy -N ""

# Authorize the key to log in
cat ~/.ssh/github_deploy.pub >> ~/.ssh/authorized_keys

# Display the PRIVATE key — copy this for GitHub
cat ~/.ssh/github_deploy
```

- [ ] SSH key pair generated
- [ ] Public key added to `authorized_keys`
- [ ] Private key copied (you'll paste into GitHub in Step 2)

---

## Step 2: Add GitHub Repository Secrets

Go to: **https://github.com/Zunkireelabs/edgexcrm/settings/secrets/actions**

Click **"New repository secret"** for each:

| # | Secret Name | Value | Where to Get It |
|---|-------------|-------|-----------------|
| 1 | `SSH_PRIVATE_KEY` | Full private key from Step 1 | `cat ~/.ssh/github_deploy` on server |
| 2 | `SSH_HOST` | `94.136.189.213` | Server IP |
| 3 | `SSH_USERNAME` | `zunkireelabs` | SSH login username |
| 4 | `NEXT_PUBLIC_SUPABASE_URL` | `https://pirhnklvtjjpuvbvibxf.supabase.co` | `.env.local` on server |
| 5 | `NEXT_PUBLIC_SUPABASE_ANON_KEY` | `eyJhbGciOiJI...` (full key) | `.env.local` on server |
| 6 | `NEXT_PUBLIC_APP_URL` | `https://lead-crm.zunkireelabs.com` | Production domain |

- [ ] `SSH_PRIVATE_KEY` added
- [ ] `SSH_HOST` added
- [ ] `SSH_USERNAME` added
- [ ] `NEXT_PUBLIC_SUPABASE_URL` added
- [ ] `NEXT_PUBLIC_SUPABASE_ANON_KEY` added
- [ ] `NEXT_PUBLIC_APP_URL` added

---

## Step 3: Create GitHub Environments

Go to: **https://github.com/Zunkireelabs/edgexcrm/settings/environments**

### Staging Environment
1. Click **"New environment"**
2. Name it: `staging`
3. Save (no approval needed)

### Production Environment
1. Click **"New environment"**
2. Name it: `production`
3. (Optional) Enable **"Required reviewers"** for manual approval before production deploys
4. Save

- [ ] `staging` environment created
- [ ] `production` environment created

---

## Step 4: Verify Build Passes Locally

Before pushing the workflows, make sure the project builds cleanly:

```bash
cd /home/zunkireelabs/devprojects/lead-gen-crm

# Lint
npm run lint

# Type check
npx tsc --noEmit

# Build
npm run build
```

- [ ] `npm run lint` passes
- [ ] `npx tsc --noEmit` passes
- [ ] `npm run build` passes

---

## Step 5: Commit and Push Workflow Files

The workflow files are already created at:

```
.github/workflows/
  ci.yml                # PR checks (lint + typecheck + build)
  deploy-staging.yml    # Auto-deploy to staging on push to stage
  deploy.yml            # Auto-deploy to production on push to main
  rollback.yml          # Manual rollback for production
```

```bash
cd /home/zunkireelabs/devprojects/lead-gen-crm
git add .github/workflows/ .claude/skills/ci-cd/ docs/ci-cd-pipeline-setup/
git commit -m "Add CI/CD pipelines: PR checks, staging deploy, production deploy, rollback"
git push origin main
```

**Note**: This push to `main` will trigger the production deploy pipeline. Make sure Steps 1-3 are done first, or the deploy step will fail (CI checks will still run and pass).

- [ ] Workflow files committed
- [ ] Pushed to `main`

---

## Step 6: Verify First Production Deploy

After pushing to main, the deploy pipeline runs automatically.

1. Go to: **https://github.com/Zunkireelabs/edgexcrm/actions**
2. Click the latest **"Deploy to Production"** run
3. Watch the jobs: `checks` → `deploy`
4. Verify all steps pass (green checkmarks)

If it fails:
- **SSH connection refused**: Check `SSH_PRIVATE_KEY` secret includes full key with `-----BEGIN/END-----` lines
- **Build fails**: Fix TypeScript/lint errors locally first
- **Health check timeout**: Check `docker logs leads-crm` on server

- [ ] Production deploy pipeline ran successfully
- [ ] `lead-crm.zunkireelabs.com` is live and healthy

---

## Step 7: Boot Up Staging Container

The staging clone is ready but the container hasn't been started yet. Start it manually the first time:

```bash
cd /home/zunkireelabs/devprojects/lead-gen-crm-dev
npm install
docker compose up -d --build
```

Wait for it to be healthy:
```bash
docker ps --filter name=leads-crm-dev --format "{{.Status}}"
curl -s -o /dev/null -w "%{http_code}" https://dev-lead-crm.zunkireelabs.com/login
```

- [ ] Staging container started
- [ ] `dev-lead-crm.zunkireelabs.com` is live and healthy

---

## Step 8: Test Staging Deploy Pipeline

Push the workflow files to the `stage` branch too:

```bash
cd /home/zunkireelabs/devprojects/lead-gen-crm
git checkout stage
git merge main
git push origin stage
```

1. Go to: **https://github.com/Zunkireelabs/edgexcrm/actions**
2. Click the latest **"Deploy to Staging"** run
3. Verify it passes

- [ ] Staging deploy pipeline ran successfully
- [ ] `dev-lead-crm.zunkireelabs.com` updated

---

## Step 9: Test CI on a Pull Request

Create a test PR to verify CI checks work:

```bash
git checkout stage
git checkout -b feature/test-ci
# Make a small harmless change
echo "// ci test" >> src/app/page.tsx
git add src/app/page.tsx
git commit -m "test: verify CI pipeline"
git push -u origin feature/test-ci
```

1. Go to GitHub and create a PR from `feature/test-ci` → `stage`
2. Watch CI checks run (lint, typecheck, build)
3. Verify they pass
4. Close the PR without merging

```bash
# Clean up
git checkout stage
git branch -d feature/test-ci
git push origin --delete feature/test-ci
```

- [ ] Test PR created
- [ ] CI checks ran and passed
- [ ] Test PR closed and branch cleaned up

---

## Step 10: (Optional) Set Up Branch Protection

Go to: **https://github.com/Zunkireelabs/edgexcrm/settings/branches**

### Protect `main`:
1. Click **"Add branch ruleset"**
2. Branch name pattern: `main`
3. Enable:
   - [x] Require a pull request before merging
   - [x] Require status checks to pass (add: `Lint`, `Type Check`, `Build`)
   - [x] Require branches to be up to date before merging
4. Save

### Protect `stage`:
1. Same as above but for `stage`
2. (Optional) Less strict — you might allow direct push for hotfixes

- [ ] `main` branch protection configured
- [ ] `stage` branch protection configured

---

## Step 11: Test Rollback (Dry Run)

Know how to rollback before you need to:

1. Find a known-good commit: `git log --oneline -5`
2. Go to: **https://github.com/Zunkireelabs/edgexcrm/actions/workflows/rollback.yml**
3. Click **"Run workflow"**
4. Enter the commit SHA and reason
5. Verify it rolls back successfully

- [ ] Rollback tested successfully

---

## How It All Works (Reference)

```
Developer creates PR        CI runs (lint + typecheck + build)
  feature/* → stage              ↓ Must pass to merge
                            PR merged to stage
                                 ↓
                            Staging deploy triggers
                                 ↓
                            SSH → lead-gen-crm-dev/ → git pull → docker build
                                 ↓
                            dev-lead-crm.zunkireelabs.com updated
                                 ↓
                            QA / test on staging
                                 ↓
                            PR created: stage → main
                                 ↓
                            CI runs again
                                 ↓
                            PR merged to main
                                 ↓
                            Production deploy triggers
                                 ↓
                            SSH → lead-gen-crm/ → git pull → docker build
                                 ↓
                            lead-crm.zunkireelabs.com updated ✅

Something breaks           → GitHub Actions → Rollback → enter SHA → ✅ reverted
```

---

## Files Reference

| File | Purpose |
|------|---------|
| `.github/workflows/ci.yml` | PR checks — lint, typecheck, build |
| `.github/workflows/deploy-staging.yml` | Auto-deploy to staging on push to `stage` |
| `.github/workflows/deploy.yml` | Auto-deploy to production on push to `main` |
| `.github/workflows/rollback.yml` | Manual rollback to any commit SHA |
| `.claude/skills/ci-cd/SKILL.md` | CI/CD skill for Claude Code |
| `docs/ci-cd-pipeline-setup/WORKFLOW.md` | Developer workflow documentation |

### VPS Directory Structure

```
/home/zunkireelabs/devprojects/
  ├── lead-gen-crm/              # Production (main branch)
  │   ├── docker-compose.yml     # Container: leads-crm
  │   └── .env.local
  └── lead-gen-crm-dev/          # Staging (stage branch)
      ├── docker-compose.yml     # Container: leads-crm-dev
      └── .env.local
```

---

## Troubleshooting Quick Reference

| Problem | Check | Fix |
|---------|-------|-----|
| SSH connection fails | Is `SSH_PRIVATE_KEY` correct? Include full key with headers | Re-copy from `cat ~/.ssh/github_deploy` |
| Build fails in CI | Check Actions log for the error | Fix locally, push again |
| Production deploy works but staging fails | Are both clones up to date? | `cd lead-gen-crm-dev && git pull origin stage` |
| Deploy succeeds but site is down | `docker logs leads-crm --tail 100` | Check for missing env vars in `.env.local` |
| Health check fails | Is Traefik routing correctly? | Check DNS + `docker ps` for container status |
| Staging shows wrong code | Is the clone on the right branch? | `cd lead-gen-crm-dev && git branch` → should show `stage` |
| Rollback fails | Is the commit SHA valid? | `git log --oneline` to find correct SHA |
| Two containers conflicting | Are container names unique? | `leads-crm` vs `leads-crm-dev` — check `docker ps` |
