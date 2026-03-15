# CI/CD Workflow — Lead Gen CRM

Complete development and deployment workflow for the Lead Gen CRM project.

---

## Environments

| Environment | URL | Branch | Container | Purpose |
|-------------|-----|--------|-----------|---------|
| **Local** | `localhost:3000` | `feature/*` | None (npm run dev) | Development |
| **Staging** | `dev-lead-crm.zunkireelabs.com` | `stage` | `leads-crm-dev` | Testing & QA |
| **Production** | `lead-crm.zunkireelabs.com` | `main` | `leads-crm` | Live site |

All environments share the same Supabase database (planned to separate in the future).

---

## Infrastructure

```
┌─────────────────────────────────────────────────────────┐
│                  VPS (94.136.189.213)                    │
│                                                         │
│  ┌─────────────────────────────────────────────────┐    │
│  │                   Traefik                        │    │
│  │            (Reverse Proxy + SSL)                 │    │
│  │                                                  │    │
│  │   lead-crm.zunkireelabs.com ──────► :3000        │    │
│  │   dev-lead-crm.zunkireelabs.com ──► :3001        │    │
│  └─────────────────────────────────────────────────┘    │
│                    │               │                     │
│           ┌───────▼──────┐ ┌──────▼───────┐             │
│           │  leads-crm   │ │leads-crm-dev │             │
│           │ (Production) │ │  (Staging)   │             │
│           │  branch:main │ │ branch:stage │             │
│           └──────────────┘ └──────────────┘             │
│                                                         │
│  /home/zunkireelabs/devprojects/                        │
│    ├── lead-gen-crm/          ← Production clone        │
│    └── lead-gen-crm-dev/      ← Staging clone           │
│                                                         │
│                    ┌──────────┐                          │
│                    │ Supabase │ (shared, external)       │
│                    └──────────┘                          │
└─────────────────────────────────────────────────────────┘
```

---

## Branching Strategy

```
feature/my-feature          (developer works here)
       │
       │  Pull Request
       ▼
     stage                  (integration + QA branch)
       │                     → auto-deploys to dev-lead-crm.zunkireelabs.com
       │
       │  Pull Request (after QA passes)
       ▼
     main                   (production-ready)
                             → auto-deploys to lead-crm.zunkireelabs.com
```

### Branch Rules

| Branch | Who Pushes | Direct Push? | Deploy Target |
|--------|-----------|-------------|---------------|
| `feature/*` | Any developer | N/A | None (local only) |
| `stage` | Merge via PR only | No | Staging |
| `main` | Merge via PR only | No | Production |

---

## Developer Workflow (Step by Step)

### 1. Start a New Feature

```bash
# Always start from the latest stage branch
git checkout stage
git pull origin stage

# Create your feature branch
git checkout -b feature/my-feature-name
```

### 2. Develop Locally

```bash
# Run the dev server
npm run dev

# Open http://localhost:3000
# Make your changes, test locally
```

### 3. Push and Create PR to `stage`

```bash
# Commit your work
git add <files>
git commit -m "feat: describe what you built"

# Push your branch
git push -u origin feature/my-feature-name
```

Then on GitHub:
1. Go to https://github.com/Zunkireelabs/edgexcrm
2. Click **"Compare & pull request"**
3. Set base branch to **`stage`** (not main!)
4. Fill in the PR description
5. Submit

### 4. CI Checks Run Automatically

When you create the PR, GitHub Actions runs:

```
┌─────────┐     ┌─────────────┐     ┌─────────┐
│  Lint   │     │  TypeCheck  │     │  Build  │
│ eslint  │     │ tsc --noEmit│     │next build│
└────┬────┘     └──────┬──────┘     └────┬────┘
     │                 │                  │
     └────────┬────────┘                  │
              │   Must pass first         │
              └───────────────────────────┘
                          │
                    All 3 must pass
                    before merge is allowed
```

- ✅ All pass → PR is ready to merge
- ❌ Any fails → Fix the issue, push again, CI re-runs

### 5. Merge to `stage` → Auto-Deploy to Staging

Once CI passes and the PR is approved:
1. Click **"Merge pull request"** on GitHub
2. The staging deploy pipeline triggers automatically:

```
Push to stage
     │
     ▼
┌──────────────────┐
│  Pre-deploy      │
│  Checks          │
│  (lint+type+build)│
└────────┬─────────┘
         │ pass
         ▼
┌──────────────────┐
│  Deploy to       │
│  Staging         │
│                  │
│  SSH into VPS    │
│  cd lead-gen-    │
│    crm-dev/      │
│  git pull        │
│  docker compose  │
│    up -d --build │
└────────┬─────────┘
         │
         ▼
┌──────────────────┐
│  Health Check    │
│  curl dev-lead-  │
│  crm.zunkiree    │
│  labs.com/login  │
│  → expect 200   │
└────────┬─────────┘
         │
         ▼
   ✅ Live on staging
```

3. Test your changes at **https://dev-lead-crm.zunkireelabs.com**

### 6. Promote to Production

When staging is tested and ready:

1. Create a PR from **`stage`** → **`main`**
2. CI checks run again
3. Merge the PR
4. Production deploy triggers automatically (same flow, but to `lead-crm.zunkireelabs.com`)

```
stage ──PR──► main ──auto-deploy──► lead-crm.zunkireelabs.com
```

### 7. If Something Goes Wrong → Rollback

```
GitHub Actions tab
     │
     ▼
Click "Rollback" workflow
     │
     ▼
Enter last known-good commit SHA
     │
     ▼
Pipeline rolls back production to that commit
     │
     ▼
✅ Previous version restored
```

Find the last good commit:
```bash
git log --oneline -10
```

---

## Complete Flow Diagram

```
 DEVELOPER                   GITHUB                        VPS
 ────────                    ──────                        ───

 local dev
 (npm run dev)
      │
      │ git push
      ▼
                         ┌──────────────┐
                         │  PR created  │
                         │  → stage     │
                         └──────┬───────┘
                                │
                         ┌──────▼───────┐
                         │   CI CHECKS  │
                         │  lint        │
                         │  typecheck   │
                         │  build       │
                         └──────┬───────┘
                                │ ✅ pass
                         ┌──────▼───────┐
                         │   MERGE      │
                         │   to stage   │
                         └──────┬───────┘
                                │
                                │ trigger         ┌──────────────────┐
                                └────────────────►│ STAGING DEPLOY   │
                                                  │ leads-crm-dev    │
                                                  │ dev-lead-crm.    │
                                                  │ zunkireelabs.com │
                                                  └──────────────────┘
 QA / review on staging
      │
      │ looks good
      ▼
                         ┌──────────────┐
                         │  PR created  │
                         │  stage→main  │
                         └──────┬───────┘
                                │
                         ┌──────▼───────┐
                         │   CI CHECKS  │
                         │   (again)    │
                         └──────┬───────┘
                                │ ✅ pass
                         ┌──────▼───────┐
                         │   MERGE      │
                         │   to main    │
                         └──────┬───────┘
                                │
                                │ trigger         ┌──────────────────┐
                                └────────────────►│ PRODUCTION DEPLOY│
                                                  │ leads-crm        │
                                                  │ lead-crm.        │
                                                  │ zunkireelabs.com │
                                                  └──────────────────┘
```

---

## How Auto-Deploy Works (Under the Hood)

When code is pushed to `stage` or `main`, GitHub Actions **SSHs into your VPS** and runs the same commands you'd run manually. No developer needs server access.

```
 Developer pushes               GitHub Actions                     Your VPS
 to "stage" branch              (free Ubuntu VM)                   (94.136.189.213)

       │
       └──────► GitHub detects push
                       │
                       ▼
                Spins up a runner
                (temporary Ubuntu VM)
                       │
                       ▼
                Runs lint + typecheck + build
                (on GitHub's server, not yours)
                       │
                       │ ✅ all pass
                       ▼
                Opens SSH connection ─────────────────────► SSH login using
                using SSH_PRIVATE_KEY                       deploy key from
                stored in GitHub Secrets                    GitHub Secrets
                                                                   │
                                                                   ▼
                                                            cd /home/zunkireelabs/
                                                              devprojects/
                                                              lead-gen-crm-dev/
                                                                   │
                                                                   ▼
                                                            git pull origin stage
                                                            (downloads latest code)
                                                                   │
                                                                   ▼
                                                            docker compose up -d --build
                                                            (rebuilds container)
                                                                   │
                                                                   ▼
                                                            Container restarts with
                                                            new code. Traefik routes
                                                            dev-lead-crm.zunkireelabs.com
                                                            to this container.
                                                                   │
                                                            ◄──────┘
                SSH reports success
                       │
                       ▼
                Health check:
                curl dev-lead-crm.zunkireelabs.com/login
                → HTTP 200 = ✅ done
```

### What Makes This Possible

| Component | Role |
|-----------|------|
| **SSH key in GitHub Secrets** | Lets GitHub log into your VPS without a password |
| **Repo clone on VPS** | `git pull` downloads the latest code |
| **Docker Compose on VPS** | Rebuilds and restarts the container |
| **Traefik on VPS** | Routes the domain to the correct container |

### Same Process for Both Environments

| Step | Staging | Production |
|------|---------|------------|
| Trigger | Push to `stage` | Push to `main` |
| SSH target | `lead-gen-crm-dev/` | `lead-gen-crm/` |
| Command | `git pull origin stage` | `git pull origin main` |
| Container | `leads-crm-dev` (port 3001) | `leads-crm` (port 3000) |
| Health check URL | `dev-lead-crm.zunkireelabs.com/login` | `lead-crm.zunkireelabs.com/login` |

No developer ever needs to SSH into the server. GitHub does it automatically.

---

## Pipeline Files

| File | Trigger | What It Does |
|------|---------|-------------|
| `.github/workflows/ci.yml` | PR to `stage` or `main` | Lint + typecheck + build check |
| `.github/workflows/deploy-staging.yml` | Push to `stage` | Deploy to `dev-lead-crm.zunkireelabs.com` |
| `.github/workflows/deploy.yml` | Push to `main` | Deploy to `lead-crm.zunkireelabs.com` |
| `.github/workflows/rollback.yml` | Manual trigger | Rollback production to a specific commit |

---

## Quick Reference

### Daily Commands

```bash
# Start working
git checkout stage && git pull
git checkout -b feature/my-task

# Done working
git add <files>
git commit -m "feat: what I did"
git push -u origin feature/my-task
# → Create PR to stage on GitHub

# Check CI status
# → GitHub PR page shows check results
```

### Emergency

```bash
# Find last good commit
git log --oneline -10

# Trigger rollback
# → GitHub Actions → Rollback → Run workflow → Enter SHA
```

### Check Environments

```bash
# Staging
curl -s -o /dev/null -w "%{http_code}" https://dev-lead-crm.zunkireelabs.com/login

# Production
curl -s -o /dev/null -w "%{http_code}" https://lead-crm.zunkireelabs.com/login
```

---

## Future Improvements

- [ ] Separate Supabase project for staging (full data isolation)
- [ ] Staging database seeded with test data automatically
- [ ] Slack/Discord notifications on deploy success/failure
- [ ] Preview deployments for individual PRs
- [ ] Automated E2E tests running on staging before production promote
- [ ] Container registry (build once, deploy anywhere) when scaling to multiple servers
