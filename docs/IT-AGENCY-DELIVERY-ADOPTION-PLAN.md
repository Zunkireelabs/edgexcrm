# it_agency Delivery — Adoption Plan

**Goal (Sadin, 2026-09-08):** all of Zunkiree's delivery work — projects, project management, tasks, time — actually happens inside EdgeX.
**Author:** Opus planning session. Decisions below are made, not proposed. Where I chose, I say why.
**Supersedes:** the "Dispatch Loop" round brief (folded in as Round 1).

---

## 1. The diagnosis, stated once

Three read-only prod probes (2026-09-08, `pirhnklvtjjpuvbvibxf`):

- 10 projects, all Zunkiree. Mobilise: 1 owner, 0 projects.
- **0 milestones. 0 invoices. 0 approvals used.** Four months.
- 22 tasks, 12 time entries, 10.9 hours, two people.
- **One person has ever assigned work to another:** `sadin@` → `hardik@` (4), `sadin@` → `anish@` (1). No other pair exists.
- Manjila created 3 tasks unprompted (May–Jul) and stopped.
- Zunkiree is 1 owner + 5 admins — no other role. Every permission gate is open to everyone.

**We built an enterprise delivery suite for a six-person agency whose actual unit of work is one person telling one other person to do something.** Milestones, approvals, invoicing, resourcing, utilization, timesheet compliance — all shipped, all correct, all serving zero rows in production.

The tool is not losing to a competitor. It is losing to WhatsApp, because WhatsApp is where the instruction is given and EdgeX is where it would have to be re-typed. **Nothing gets adopted until being in EdgeX is cheaper than not being in EdgeX.** That is the entire design constraint, and every round below is judged against it.

## 2. The three habits that have to form

Delivery lives in EdgeX only if all three hold. They are load-bearing in order:

| | Habit | Currently |
|---|---|---|
| **H1 Capture** | Work becomes a task in EdgeX at the moment it is decided | Fails — typing it in WhatsApp is faster |
| **H2 Attention** | People learn what to do without being told elsewhere | Fails — notifications never leave the app |
| **H3 Effort** | Time gets recorded without ceremony | Partly — the timer exists, nothing prompts it |

A tool that nails H1 and fails H2 is a write-only archive. Nails H2, fails H1: an empty inbox. **Both must land before anything else is worth building** — which is why Rounds 1 and 2 are the plan and Rounds 3–4 are the follow-through.

## 3. Sequence

### Round 0 — Promote to prod. This week. (no build)

Phase 6 is on stage. **Zunkiree uses prod.** Every round below is worthless until it reaches `main`, and we currently have Phases 4/5 on prod (2026-09-07) and Phase 6 stranded on stage.

Promotion carries #514 (mig 228, `max_recipients_per_blast`) and is gated on Admizz's cap `UPDATE` landing in the same window — their audience is 3,131, and promoting without it hard-rejects their blast with `MAX_RECIPIENTS_EXCEEDED`. §197 reconcile: cut `promote/stage-to-main-<date>-<slug>` off `origin/stage`, merge `origin/main` in, build, PR → main. Merge commit, not squash, never `--delete-branch`.

**Standing rule from here on: delivery work reaches prod within a week of merging to stage, or we are measuring nothing.**

### Round 1 — Dispatch loop: make the loop close and leave the app (H2)

Three breaks, all verified in code:

1. **The loop never closes back.** A task reaching `done` notifies nobody. `assigned_by_id` is written on every task and read by nothing. Sadin learns work is finished by asking on WhatsApp — the exact behaviour that keeps delivery outside EdgeX.
2. **Notifications only reach someone already inside the app.** `createNotificationsExcept` writes a bell row; there is no email/push path. Hardik learns about a task when he opens EdgeX, and he only opens EdgeX because someone told him elsewhere.
3. **Project tasks have no reminders.** `runTaskReminders` (`src/lib/inngest/jobs/reminders.ts:13`) scans `lead_checklists` only. `tasks.due_date` exists and no scheduled job reads it.

Build: `TASK_COMPLETED` notification to `assigned_by_id`; transactional email on assign + complete (clone of the proven `sendLeadAssignedEmail`); project-task due reminders on the existing 15-minute Inngest scan. **Migration 230** — one nullable `tasks.reminded_at` stamp.

**Decisions made** (these were open questions; I am closing them):
- **Instant email, not digest.** ~5 dispatched tasks a quarter. A digest of one item is noise about nothing; instant is the whole point.
- **No per-user preference.** Six people who know each other. Ship a single tenant-level switch, default ON for it_agency. Per-user prefs when a second tenant asks.
- **Two events only** — assigned, completed. Every additional email type reduces the chance the first two get read.

### Round 2 — Capture: beat WhatsApp on speed (H1)

The decisive round. If creating a task takes longer than typing the sentence into WhatsApp, EdgeX loses every time and no notification work matters.

- Global quick-add from anywhere (the ⌘K surface already exists): type a title, pick a person, done. Under three seconds, no project required.
- Multi-line paste → multiple tasks. This is how a briefing conversation becomes a task list in one action.
- Create a task **from an inbox email/message** and from a lead/deal, carrying the context link that already exists.

*Sized after Round 1 ships; likely no migration — `tasks.project_id` is already nullable-adjacent via mig 224's internal-project work, to be confirmed at brief time.*

### Round 3 — Effort without ceremony (H3)

- The timer, everywhere a task appears — not just the cockpit.
- A weekly "you logged 3 hours, is that right?" nudge instead of the compliance report nobody reads.
- **Auto-approve time entries for tenants with no approval habit.** Today's two 1-minute smoke entries are sitting in the prod approvals inbox as `pending` and will sit there forever. An approval queue nobody clears trains people to ignore the app.

### Round 4 — The dispatcher's one screen

One view answering *what moved, what's stuck, who has nothing* — so Sadin never has to ask on WhatsApp. This is the round that makes the manager a daily user rather than a monthly one. Built last because it is only truthful once Rounds 1–3 populate it.

### Cross-cutting — hide what nobody uses

A tenant-level **"advanced delivery"** switch, default OFF: milestones, approvals, invoicing, utilization, resourcing stay in the code and behind the switch. Not deleted — off. A six-person agency should not have to walk past five empty enterprise surfaces to reach their task list. Turn it on the day a tenant needs milestone billing.

## 4. WhatsApp — named, deliberately deferred

WhatsApp is where this team actually works, and the honest end state for H2 in Nepal is a WhatsApp message, not an email. It is not in Rounds 1–4 because the channel is **broken on prod** (Meta test number, verified-failing sends, owned by Hardik). Email works today and proves the mechanism. When the channel is fixed, Round 1's notification path gains WhatsApp as a second transport — the seam is the same. Do not block Round 1 on it.

## 5. What we are not building

No sprints, dependencies, phases, portfolio roll-up, project templates, client portal. No new milestone/invoice/approval capability — those surfaces have zero production rows; adding to them is building for nobody. No Positions/RBAC middle tier (every Zunkiree member is an admin; the gate is a no-op there). No redesign of Home or the cockpit — Phase 6 just landed, let it be observed.

## 6. How we know it worked

Not "the code shipped." Re-run the probe monthly and watch three numbers:

1. **Distinct assigner→assignee pairs.** Today: 2. If Round 1–2 work, other people start dispatching, not just Sadin.
2. **Median gap between `created_at` and first status change.** The real question is whether a task is opened in EdgeX *before* someone mentions it in WhatsApp.
3. **Tasks created per week.** Round 2 either moves this or Round 2 failed.

If those three are flat 30 days after Round 2 reaches prod, the answer is not another delivery round — it is that this team will not run delivery in a web app, and we should be building the WhatsApp-first version instead. **That is a real possible outcome and we should be willing to see it.**

## 7. One thing I cannot derive

Manjila adopted this unprompted in May, created three tasks, and stopped in July. She is the only organic adopter in the data and nothing in this plan explains her. One conversation with her is worth more than the next two rounds of my guessing — ask what made her stop.
