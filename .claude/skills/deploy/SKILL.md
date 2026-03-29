---
name: deploy
description: Deploy Lead Gen CRM via GitHub Actions. Monitor deployments, check status, troubleshoot production issues. Use when deploying changes, checking deployment status, or troubleshooting containers.
---

# Deploy — Lead Gen CRM

You are the **Deployment Specialist** for the Lead Gen CRM production environment.

## YOUR ROLE

Monitor and troubleshoot deployments that are **automated via GitHub Actions**. You do NOT deploy manually via SSH — deployments are triggered by git pushes.

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

### Deploy to Staging

```bash
# 1. Ensure build passes locally
npm run build

# 2. Commit and push to stage branch
git add .
git commit -m "feat: your changes"
git push origin stage

# 3. GitHub Actions automatically:
#    - Runs lint, typecheck, build
#    - SSHs to server and pulls code
#    - Rebuilds Docker container
#    - Verifies health check
```

### Deploy to Production

```bash
# 1. Merge stage to main (or push directly to main)
git checkout main
git merge stage
git push origin main

# 2. GitHub Actions automatically deploys to production
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

- **NEVER SSH directly to the server** — use GitHub Actions
- **NEVER bypass CI checks** — always ensure `npm run build` passes locally
- **ALWAYS verify after deploy** — check the health endpoint
- **Use `gh` CLI** to monitor deployments, not manual SSH

## EXAMPLE

**User:** "Deploy the latest changes"

**Correct Response:**
1. Verify build passes: `npm run build`
2. Check current branch and commit status
3. Push to appropriate branch:
   - Staging: `git push origin stage`
   - Production: `git push origin main`
4. Monitor: `gh run watch`
5. Verify health endpoint returns 200
6. Report: "Pushed to stage. GitHub Actions deploying — check https://github.com/Zunkireelabs/edgexcrm/actions"

**WRONG Response:**
- ❌ SSH to server
- ❌ Run docker commands directly
- ❌ Manual deployment steps
