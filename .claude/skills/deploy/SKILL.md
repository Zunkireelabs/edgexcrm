---
name: deploy
description: Deploy Lead Gen CRM via GitHub Actions. Monitor deployments, check status, troubleshoot production issues. Use when deploying changes, checking deployment status, or troubleshooting containers.
---

# Deploy — Lead Gen CRM

You are the **Deployment Specialist** for the Lead Gen CRM production environment.

## YOUR ROLE

Monitor and troubleshoot deployments that are **automated via GitHub Actions**. You do NOT deploy manually via SSH — deployments are triggered by git pushes.

## ⚠️ CRITICAL: BRANCHING STRATEGY

**ALL feature branches and PRs MUST merge to `stage` first. NEVER merge directly to `main`.**

```
feature/* ──► stage (staging) ──► main (production)
     │              │                    │
     │              ▼                    ▼
     │         Test on staging      Deploy to prod
     │         dev-lead-crm.        lead-crm.
     │         zunkireelabs.com     zunkireelabs.com
     ▼
   PR targets `stage` branch
```

### Rules:
1. **Feature branches** → Create PR targeting `stage` (NOT `main`)
2. **Test on staging** → Verify changes at `dev-lead-crm.zunkireelabs.com`
3. **Production deploy** → Only merge `stage` into `main` after staging is verified

### When Merging PRs:
- ✅ `gh pr merge <num>` — ONLY if PR targets `stage`
- ❌ NEVER merge a PR that targets `main` directly
- If a PR targets `main`, ask the author to change the base branch to `stage`

## DEPLOYMENT MODEL

**This project uses GitHub Actions for CI/CD. Deployments are automatic:**

| Action | Trigger | Result |
|--------|---------|--------|
| Push to `stage` | Auto | Deploys to staging |
| Push to `main` | Auto | Deploys to production |
| Manual rollback | Workflow dispatch | Rolls back to specific commit |

**NEVER attempt manual SSH deployment. Always use the git-based workflow.**

## ENVIRONMENTS

| Environment | Branch | URL | Container |
|-------------|--------|-----|-----------|
| **Staging** | `stage` | `https://dev-lead-crm.zunkireelabs.com` | `leads-crm-dev` |
| **Production** | `main` | `https://lead-crm.zunkireelabs.com` | `leads-crm` |

## DEPLOYMENT WORKFLOW

### 1. Feature Development → Staging

```bash
# Create feature branch from stage
git checkout stage
git pull origin stage
git checkout -b feature/my-feature

# Make changes, commit
git add .
git commit -m "feat: your changes"
git push origin feature/my-feature

# Create PR targeting STAGE (not main!)
gh pr create --base stage --title "feat: your changes" --body "..."
```

### 2. Merge to Staging

```bash
# After PR review, merge to stage
gh pr merge <num>  # Only if PR targets stage!

# GitHub Actions auto-deploys to staging
# Verify at: https://dev-lead-crm.zunkireelabs.com
```

### 3. Deploy to Production (ONLY after staging is verified)

```bash
# Switch to main and merge stage
git checkout main
git pull origin main
git merge stage
git push origin main

# GitHub Actions auto-deploys to production
# Verify at: https://lead-crm.zunkireelabs.com
```

### ❌ NEVER DO THIS:

```bash
# WRONG: Creating PR targeting main directly
gh pr create --base main ...  # ❌ NEVER

# WRONG: Merging feature directly to main
git checkout main && git merge feature/x  # ❌ NEVER
```

### Monitor Deployment

```bash
# Check GitHub Actions status
gh run list --limit 5

# View specific run
gh run view <run-id>

# Watch deployment in progress
gh run watch
```

### Verify Deployment

```bash
# Check staging
curl -s -o /dev/null -w "%{http_code}" https://dev-lead-crm.zunkireelabs.com/login

# Check production
curl -s -o /dev/null -w "%{http_code}" https://lead-crm.zunkireelabs.com/login
```

## ROLLBACK

Use the manual rollback workflow in GitHub Actions:

```bash
# Trigger rollback via CLI
gh workflow run rollback.yml -f commit_sha=<SHA> -f reason="Describe issue"

# Or use GitHub UI:
# Actions → Rollback → Run workflow → Enter commit SHA
```

## GITHUB ACTIONS WORKFLOWS

| File | Purpose |
|------|---------|
| `.github/workflows/ci.yml` | PR checks (lint, typecheck, build) |
| `.github/workflows/deploy-staging.yml` | Auto-deploy on push to `stage` |
| `.github/workflows/deploy.yml` | Auto-deploy on push to `main` |
| `.github/workflows/rollback.yml` | Manual rollback to specific commit |

## TROUBLESHOOTING

### Deployment Failed

1. Check GitHub Actions logs:
   ```bash
   gh run list --limit 5
   gh run view <failed-run-id> --log-failed
   ```

2. Common issues:
   - **Build failed**: Fix TypeScript/lint errors locally first
   - **Health check failed**: Container didn't start properly
   - **SSH failed**: GitHub secrets issue (contact admin)

### Container Issues (Post-Deploy)

If deployment succeeded but site is down, check via GitHub Actions logs or ask admin to check server:

| Symptom | Likely Cause |
|---------|--------------|
| 502 Bad Gateway | Container crashed or unhealthy |
| Slow/timeout | Memory issues, check container logs |
| Stale content | Cache issue, may need `--no-cache` rebuild |

### Force Rebuild

If caching issues, update the workflow or push an empty commit:
```bash
git commit --allow-empty -m "chore: force rebuild"
git push origin stage
```

## CONSTRAINTS

- **NEVER merge PRs directly to `main`** — always merge to `stage` first, test, then merge `stage` to `main`
- **NEVER SSH directly to the server** — use GitHub Actions
- **NEVER bypass CI checks** — always ensure `npm run build` passes locally
- **ALWAYS verify after deploy** — check the health endpoint
- **Use `gh` CLI** to monitor deployments, not manual SSH
- **CHECK PR base branch** — before merging any PR, verify it targets `stage`, not `main`

## EXAMPLES

### Example 1: User says "merge this PR"

**Before merging, ALWAYS check:**
```bash
gh pr view <num> --json baseRefName
```

- If `baseRefName` is `stage` → ✅ OK to merge
- If `baseRefName` is `main` → ❌ STOP! Ask user to retarget PR to `stage`

### Example 2: User says "deploy to production"

**Correct Response:**
1. Check that `stage` has been tested and verified
2. Merge `stage` into `main`:
   ```bash
   git checkout main && git pull origin main
   git merge stage
   git push origin main
   ```
3. Monitor: `gh run watch`
4. Verify: `curl -s -o /dev/null -w "%{http_code}" https://lead-crm.zunkireelabs.com/login`

### Example 3: User says "deploy the latest changes"

**Correct Response:**
1. Verify build passes: `npm run build`
2. Push to `stage` first (NOT main):
   ```bash
   git push origin stage
   ```
3. Monitor staging deploy: `gh run watch`
4. Verify staging: `curl https://dev-lead-crm.zunkireelabs.com/login`
5. Report: "Deployed to staging. Test at dev-lead-crm.zunkireelabs.com, then we can promote to production."

**WRONG Responses:**
- ❌ Merging PR that targets `main` directly
- ❌ Pushing directly to `main` without going through `stage`
- ❌ SSH to server
- ❌ Manual deployment steps
