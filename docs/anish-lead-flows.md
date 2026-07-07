# Admizz Lead Flow

## Overview

Leads progress through 4 main stages. Each stage has a dedicated position that works the leads, changes statuses, reassigns to peers, or hands off to the next position.

**Stage order:** Pre-qualified → Qualified → Prospects → Applications

---

## Stage 1: Pre-qualified

**Assigned to:** Lead Telecaller (Anusha / Asmita / Riya / Simrika — KTM branch)
**Default status:** New Lead

**Available statuses:**
- New Lead
- Attempted
- Connected
- Qualified
- Not Qualified

**Assigned To dropdown:** Shows other lead-telecallers in the same branch. Reassigns within Pre-qualified — lead stays in this stage.

**Send to next:** Dialog opens → "Assigned To" picker shows lead-executives (Kamana, Purnima — KTM). Assignee **must** be selected — Confirm button stays disabled until a lead-executive is picked. Once selected and confirmed, lead moves to **Qualified** stage. If cancelled or no assignee picked, lead stays in Pre-qualified.

---

## Stage 2: Qualified

**Assigned to:** Lead Executive (Kamana / Purnima — KTM branch)
**Default status:** New Lead

**Available statuses:**
- New Lead
- Not Connected
- Prospect Ready
- Class Ready
- Qualified
- Dropped

**Assigned To dropdown:** Shows other lead-executives in the same branch. Reassigns within Qualified — lead stays in this stage.

**Send to next:** Dialog opens → "Assigned To" picker shows counselors (Amit Rawal, Diplov Karn, Gautam Ray, Nikhil Mirdha — KTM). Assignee **must** be selected — Confirm button stays disabled until a counselor is picked. Once selected and confirmed, lead moves to **Prospects** stage. If cancelled or no assignee picked, lead stays in Qualified.

---

## Stage 3: Prospects

**Assigned to:** Counselor (Amit Rawal / Diplov Karn / Gautam Ray / Nikhil Mirdha — KTM branch)
**Default status:** Prospect Ready

**Available statuses:**
- Prospect Ready
- In Person Counseling
- Virtual Counseling
- Application Ready
- Class Ready
- Needs More Time
- Not Connected
- Not Eligible/Dropped

**Assigned To dropdown:** Shows other counselors in the same branch. Reassigns within Prospects — lead stays in this stage.

**Send to next:** Dialog opens → "Assigned To" picker shows application executives (Dikshya, Samriti — KTM). Assignee **must** be selected — Confirm button stays disabled until an application executive is picked. Once selected and confirmed, lead moves to **Applications** stage. If cancelled or no assignee picked, lead stays in Prospects.

---

## Stage 4: Applications

**Assigned to:** Application Executive (Dikshya / Samriti — KTM branch)
**Default status:** Application Ready

**Available statuses:**
- Application Ready
- Application Started
- Arranging Documents
- Conditional Received
- Unconditional Received
- Acceptance Confirmed
- Financial Preparation
- Initial Fee Paid
- Interview Prep
- Visa Date Booked
- Visa/Admission Granted
- Travel Booked
- Tuition Fee Paid
- Enrollment Done
- Dropped
- Rejected/Declined

**Assigned To dropdown:** Shows other application executives in the same branch. Reassigns within Applications.

**Send to next:** Not available — end of chain.

---

## Admin / Branch Manager Access

| Role | Who | What they can do |
|------|-----|-----------------|
| Owner | Admizz Admin, Manish K Sah | All leads, all stages, all branches |
| Admin | Mamata Sah | All leads, all stages, all branches |
| Branch Manager (KTM) | Bijay Dahal | All KTM leads across all 4 stages. Can reassign to any KTM member. Can move stages in any direction. |
| Branch Manager (Janakpur) | Manish Sah Janakpur | All Janakpur branch leads |
| Branch Manager (Birgunj) | Umesh Chaudhary | All Birgunj branch leads |

---

## Walk-in Check-in Shortcut

A lead can skip Pre-qualified and Qualified entirely via the Check-In page (`/check-in`).

### New walk-in (lead not yet in system)

Use the **Add Lead & Check In** form (appears automatically when no existing lead is found).

| Tag | "Assigned To" dropdown shows | Stage after check-in |
|-----|------------------------------|----------------------|
| Student | Counselors (same branch, or branch-unassigned) | **Prospects** — if a counselor is selected |
| Parent | Counselors (same branch, or branch-unassigned) | **Prospects** — if a counselor is selected |
| Other | All branch members (all roles) | **Contacts page only** — not placed in pipeline |

If no counselor is selected for a student/parent, the lead stays at the default intake stage (Pre-qualified / New Lead) and must be processed through the normal flow.

### Existing lead check-in

Search by email or phone → click **View Details** → right panel opens.

- **Meet with** dropdown shows all branch members (any role) — select who the visitor is meeting.
- If the selected person is a counselor → lead auto-promotes to **Prospects** at status `Prospect Ready`.
- If no one selected or the selected person is not a counselor → no auto-promotion; lead stays at its current stage.
- Click **Check In** to record the visit.

### Check-in History panel — post-check-in assignment

The **Assigned To / Meet with** column in the history list allows reassigning after check-in:

- **Student / Parent** rows → "Assigned To" — shows counselors only. Selecting a counselor triggers auto-promotion to **Prospects** (if not already there).
- **Other** rows → "Meet with" — shows all branch members. Selection records who they met; no stage change.

---

## Contacts (Walk-in Visitors — "Other" Tag)

Walk-in visitors tagged as **"other"** (non-student, non-parent) are **not placed in the lead pipeline**. They do not appear in Pre-qualified, Qualified, Prospects, or Applications.

- Stored as leads in the DB but with no stage assignment.
- Visible only in the **Contacts page** (`/contacts`), accessible to **admin and owner only**.
- Check-in history is recorded normally; notes can be added from the Contacts detail view.
- The **Meet with** dropdown shows all branch members (not counselor-only) since "other" visitors may be meeting any staff member.

---

## Assignment Chain

```
Lead Telecaller  (Pre-qualified)
       ↓  Send to next → pick Lead Executive
Lead Executive   (Qualified)
       ↓  Send to next → pick Counselor
Counselor        (Prospects)
       ↓  Send to next → pick Application Executive
Application Exec (Applications)
       ↓  End of chain
```

Each "Send to next" shows only next-position members in the same branch as picker options. Selecting an assignee is **required** — the lead does not move to the next stage until a person is picked and confirmed. Cancelling the dialog leaves the lead in its current stage.
