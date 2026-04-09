# User Assignment Feature Plan

**Branch:** `feature/user-assigment`
**Created:** 2026-04-09
**Last Updated:** 2026-04-09
**Status:** ✅ All Phases Complete

---

## Progress Summary

| Phase | Description | Status |
|-------|-------------|--------|
| Phase 1 | Team Invite Flow (Manual Link Sharing) | ✅ **Complete** |
| Phase 2 | Lead Assignment Enhancements | ✅ **Complete** |
| Phase 3 | In-App Notifications | ✅ **Complete** |
| Phase 4 | Email Notifications | ✅ **Complete** |

---

## ⚠️ IMPORTANT: What Works vs What Doesn't

### ✅ WORKS
- Invite team members → **email sent automatically** + link copied to clipboard
- New users can register via invite link (`/register?token=xxx`)
- Existing users can accept invite via login page
- Bulk assign leads from leads table
- In-app notifications for lead assignments
- In-app notifications when team members join
- Notification dropdown with ElevenLabs-style UI
- **Email notifications for invites** (via Resend)
- **Email notifications for lead assignments** (single + bulk)

### 🔵 FUTURE ENHANCEMENTS
- Email digests (daily/weekly summary)
- Email preferences per user

---

## Phase 1: Team Invite Flow ✅ COMPLETE

**Goal:** Invited users can register and join the tenant.

**⚠️ Note:** Invite emails are NOT sent automatically. The invite link is copied to clipboard and must be shared manually.

### Completed Work

| Task | File | Status |
|------|------|--------|
| Token Validation API | `src/app/(main)/api/v1/invites/validate/route.ts` | ✅ Created |
| Registration API | `src/app/(main)/api/v1/auth/register/route.ts` | ✅ Created |
| Registration Page | `src/app/(main)/(auth)/register/page.tsx` | ✅ Created |
| Login with Token | `src/app/(main)/(auth)/login/page.tsx` | ✅ Modified |
| Suspense Boundaries | Both auth pages | ✅ Fixed build errors |

### Features Implemented

1. **Registration Page (`/register?token=xxx`)**
   - Validates token on page load
   - Pre-fills email from invite (read-only)
   - Shows tenant name and role badge
   - Creates Supabase auth user + accepts invite
   - Error states: invalid, expired, already used, email mismatch

2. **Token Validation API (`GET /api/v1/invites/validate`)**
   - Public endpoint (no auth required)
   - Returns: email, role, tenant info, expiry
   - Error codes: TOKEN_NOT_FOUND, TOKEN_EXPIRED, TOKEN_ALREADY_USED

3. **Registration API (`POST /api/v1/auth/register`)**
   - Creates user account using invite token
   - Validates token, creates Supabase auth user
   - Auto-accepts invite, creates tenant_users record
   - Returns session for immediate login

4. **Existing User Flow**
   - Login page handles `?token=` parameter
   - Auto-accepts invite after successful login
   - Redirects to dashboard

### Current Invite Flow (Manual)

```
Admin clicks "Invite" → Link copied to clipboard → Admin sends link manually → User clicks link → Registration page
```

### Testing Results
- ✅ New user registration with invite token
- ✅ Existing user accepting invite via login
- ✅ Invalid/expired token error handling
- ✅ Role badge and tenant name display

---

## Phase 2: Lead Assignment Enhancements ✅ COMPLETE

**Goal:** Make assigning leads faster and support bulk operations.

### Completed Work

| Task | File | Status |
|------|------|--------|
| Bulk Assignment API | `src/app/(main)/api/v1/leads/bulk/route.ts` | ✅ Added PATCH method |
| Assign Button in Table | `src/components/dashboard/leads-table.tsx` | ✅ Added |
| Assignment Modal | `src/components/dashboard/leads-table.tsx` | ✅ Added |
| Table Horizontal Scroll | `src/components/dashboard/leads-table.tsx` | ✅ Fixed cramped columns |

### Features Implemented

1. **Bulk Assignment API (`PATCH /api/v1/leads/bulk`)**
   - Accepts array of lead IDs + assignee ID
   - Validates assignee is tenant member
   - Updates all leads atomically
   - Creates in-app notifications for assignees
   - Notifies previous assignees of reassignment

2. **Assignment UI in Leads Table**
   - "Assign to" button appears when leads are selected
   - Dialog with team member dropdown
   - Shows member count and selection count
   - Success toast with result

3. **Table UI Improvements**
   - Horizontal scroll enabled (`overflow-auto`)
   - Minimum table width (`min-w-[900px]`)
   - Column min-widths for readability
   - `whitespace-nowrap` on Form column

### Pre-existing Features (Already Worked)
- Checkbox selection in table
- Filter by status, form, search
- Individual lead assignment in detail view
- Counselor scoping (auto-filtered to assigned leads)

### Testing Results
- ✅ Bulk assign 10+ leads at once
- ✅ Correct notifications sent to assignees
- ✅ Previous assignees notified of reassignment
- ✅ Table scrolls horizontally without cramping

---

## Phase 3: In-App Notifications ✅ COMPLETE

**Goal:** Alert users when leads are assigned to them or team members join.

### Completed Work

| Task | File | Status |
|------|------|--------|
| Notifications Table | `supabase/migrations/015_notifications.sql` | ✅ Created |
| Notification Helper | `src/lib/notifications.ts` | ✅ Created |
| List Notifications API | `src/app/(main)/api/v1/notifications/route.ts` | ✅ Created |
| Mark Read API | `src/app/(main)/api/v1/notifications/[id]/read/route.ts` | ✅ Created |
| Mark All Read API | `src/app/(main)/api/v1/notifications/read-all/route.ts` | ✅ Created |
| Notifications Dropdown | `src/components/dashboard/notifications-dropdown.tsx` | ✅ Created |
| Shell Integration | `src/components/dashboard/shell.tsx` | ✅ Modified |
| Lead Assignment Triggers | `src/app/(main)/api/v1/leads/[id]/route.ts` | ✅ Modified |
| Bulk Assignment Triggers | `src/app/(main)/api/v1/leads/bulk/route.ts` | ✅ Modified |
| Team Join Triggers | `src/app/(main)/api/v1/invites/accept/route.ts` | ✅ Modified |

### Features Implemented

1. **Database Schema**
   - `notifications` table with RLS policies
   - Indexes for efficient queries (tenant_id, user_id, read_at)
   - `create_notification` helper function

2. **API Endpoints**
   - `GET /api/v1/notifications` - List with unread count
   - `POST /api/v1/notifications/:id/read` - Mark single as read
   - `POST /api/v1/notifications/read-all` - Mark all as read

3. **Notification Types**
   - `lead.assigned` - "Lead assigned to you"
   - `lead.unassigned` - "Lead reassigned"
   - `team.member_joined` - "New team member joined"
   - `invite.accepted` - "Invite accepted" (to admins)

4. **Dropdown Component (ElevenLabs-style)**
   - Bell icon with unread count badge
   - 420px wide dropdown
   - Fixed position aligned to header right edge
   - Icons in colored circle backgrounds
   - Mark as read on click
   - "Mark all read" button
   - 30-second polling for new notifications
   - Custom `formatRelativeTime` (no date-fns dependency)

### UI Polish Completed

| Change | Before | After |
|--------|--------|-------|
| Width | 320px | 420px |
| Position | Relative to bell | Fixed to header right edge |
| Border radius | rounded-xl | rounded-2xl |
| Shadow | shadow-lg | shadow-xl |
| Icons | Plain emoji | Emoji in colored circle |
| Empty state | Simple bell | Icon in circle + two-line message |

### Testing Results
- ✅ Notifications appear when leads assigned
- ✅ Previous assignees notified of reassignment
- ✅ Admins notified when team member joins
- ✅ Click notification → marks as read
- ✅ Polling works (new notifications appear)
- ✅ Dropdown aligned to header right edge

---

## Phase 4: Email Notifications ✅ COMPLETE

**Goal:** Send automatic email notifications for invites and lead assignments.

**Provider:** Resend (chosen for simplicity, generous free tier, React email support)

### Why Resend Over Supabase?

| Factor | Resend | Supabase Email |
|--------|--------|----------------|
| Custom emails (invites) | ✅ Full control | ❌ Auth emails only |
| Lead assignment emails | ✅ Supported | ❌ Not possible |
| Custom templates | ✅ React/HTML | ⚠️ Limited |
| Free tier | 3,000/month | N/A for custom |

**Verdict:** Supabase email only handles auth flows (password reset, magic links). Cannot send custom emails like invites.

---

### Implementation Overview

```
┌──────────────────────────────────────────────────────────────────┐
│                         EMAIL SYSTEM                              │
├──────────────────────────────────────────────────────────────────┤
│                                                                  │
│  ┌─────────────────┐      ┌─────────────────┐                    │
│  │  Invite Created │ ───► │  Send Invite    │ ───► 📧 Email      │
│  │  (POST /invites)│      │  Email          │      to invitee    │
│  └─────────────────┘      └─────────────────┘                    │
│                                                                  │
│  ┌─────────────────┐      ┌─────────────────┐                    │
│  │  Lead Assigned  │ ───► │  Send Assignment│ ───► 📧 Email      │
│  │  (PATCH /leads) │      │  Email          │      to assignee   │
│  └─────────────────┘      └─────────────────┘                    │
│                                                                  │
└──────────────────────────────────────────────────────────────────┘
```

### New Invite Flow (After Phase 4)

```
Admin clicks "Invite" → Invite created → Email sent automatically → User clicks link in email → Registration page
                                       ↓
                        (Link still copied to clipboard as backup)
```

---

### Files to Create (Phase 4)

| # | File | Purpose |
|---|------|---------|
| 1 | `src/lib/email/index.ts` | Resend client initialization |
| 2 | `src/lib/email/templates/invite.ts` | Invite email HTML template |
| 3 | `src/lib/email/templates/lead-assigned.ts` | Assignment email HTML template |
| 4 | `src/lib/email/send-invite.ts` | `sendInviteEmail()` function |
| 5 | `src/lib/email/send-lead-assigned.ts` | `sendLeadAssignedEmail()` function |

### Files to Modify (Phase 4)

| # | File | Changes |
|---|------|---------|
| 1 | `src/app/(main)/api/v1/invites/route.ts` | Call `sendInviteEmail()` after creating invite |
| 2 | `src/app/(main)/api/v1/leads/[id]/route.ts` | Call `sendLeadAssignedEmail()` on assignment |
| 3 | `.env.example` | Add `RESEND_API_KEY` placeholder |

---

### Email Templates Design

#### 1. Invite Email

```
┌─────────────────────────────────────────────────────────────┐
│                                                             │
│     [Tenant Name]                                           │
│                                                             │
│  ─────────────────────────────────────────────────────────  │
│                                                             │
│     You've been invited to join                             │
│                                                             │
│     RK University                                           │
│                                                             │
│     admin@zunkireelabs.com invited you to join as           │
│     Admin on the Lead Gen CRM platform.                     │
│                                                             │
│     ┌───────────────────────────────────────┐               │
│     │        Accept Invitation              │  ← Tenant's   │
│     └───────────────────────────────────────┘    primary    │
│                                                  color      │
│     This invitation will expire in 7 days.                  │
│                                                             │
│  ─────────────────────────────────────────────────────────  │
│                                                             │
│     If you didn't expect this invitation, you can           │
│     ignore this email.                                      │
│                                                             │
│     © 2026 Lead Gen CRM by Zunkiree Labs                    │
│                                                             │
└─────────────────────────────────────────────────────────────┘

Subject: "You've been invited to join [Tenant Name]"
From: "Lead Gen CRM <noreply@lead-crm.zunkireelabs.com>"
```

#### 2. Lead Assignment Email

```
┌─────────────────────────────────────────────────────────────┐
│                                                             │
│     [Tenant Name]                                           │
│                                                             │
│  ─────────────────────────────────────────────────────────  │
│                                                             │
│     New lead assigned to you                                │
│                                                             │
│     Aakriti Gautam                                          │
│     kritiaa729@gmail.com                                    │
│                                                             │
│     Assigned by admin@zunkireelabs.com                      │
│                                                             │
│     ┌───────────────────────────────────────┐               │
│     │          View Lead                    │               │
│     └───────────────────────────────────────┘               │
│                                                             │
│  ─────────────────────────────────────────────────────────  │
│                                                             │
│     © 2026 Lead Gen CRM by Zunkiree Labs                    │
│                                                             │
└─────────────────────────────────────────────────────────────┘

Subject: "New lead assigned: [Lead Name]"
From: "Lead Gen CRM <noreply@lead-crm.zunkireelabs.com>"
```

---

### Implementation Steps

#### Step 1: Install Resend
```bash
npm install resend
```

#### Step 2: Environment Setup
```bash
# .env.local
RESEND_API_KEY=re_xxxxxxxxxx
NEXT_PUBLIC_APP_URL=https://lead-crm.zunkireelabs.com
```

#### Step 3: Create Email Service
```typescript
// src/lib/email/index.ts
import { Resend } from 'resend';

export const resend = new Resend(process.env.RESEND_API_KEY);

// For production (after domain verification):
export const EMAIL_FROM = 'Lead Gen CRM <noreply@lead-crm.zunkireelabs.com>';

// For development/testing:
// export const EMAIL_FROM = 'Lead Gen CRM <onboarding@resend.dev>';
```

#### Step 4: Create Send Functions
```typescript
// src/lib/email/send-invite.ts
export async function sendInviteEmail({
  to,
  inviterEmail,
  tenantName,
  role,
  inviteLink,
  primaryColor,
}: InviteEmailParams): Promise<{ success: boolean; error?: string }>

// src/lib/email/send-lead-assigned.ts
export async function sendLeadAssignedEmail({
  to,
  assignerEmail,
  tenantName,
  leadName,
  leadEmail,
  leadLink,
}: LeadAssignedEmailParams): Promise<{ success: boolean; error?: string }>
```

#### Step 5: Integrate with APIs
- Invite creation → send invite email
- Lead assignment → send assignment email
- Both are **fire-and-forget** (don't block API on email failure)

---

### Error Handling Strategy

Emails are **non-blocking**:
```typescript
// Pattern used throughout:
sendInviteEmail(...).catch((err) => {
  log.error({ err }, 'Failed to send invite email');
  // API still succeeds - invite is created, link copied to clipboard
});
```

| Scenario | Behavior |
|----------|----------|
| Email sends successfully | User gets email + link copied |
| Email fails | Log error, link still copied (manual fallback) |
| Invalid API key | Log error, feature degrades gracefully |

---

### Production Checklist

Before going live:
- [x] Create Resend account at resend.com
- [x] Get API key from Resend dashboard
- [x] Add `RESEND_API_KEY` to production environment
- [x] Verify `lead-crm.zunkireelabs.com` domain in Resend
- [x] Test with real email addresses
- [ ] Add `RESEND_API_KEY` to GitHub Secrets for CI/CD

---

### Configuration Decisions (Pending Approval)

| Decision | Proposed | Notes |
|----------|----------|-------|
| From address | `noreply@lead-crm.zunkireelabs.com` | Requires domain verification |
| Invite emails | ✅ Include | Primary goal |
| Lead assignment emails | ✅ Include | Nice to have |
| Bulk assignment | 1 summary email | Not 10 separate emails |
| Email on reassignment | Yes (to new assignee) | Previous assignee gets in-app only |

---

## Files Created/Modified (All Phases)

### New Files (Phase 1-3) ✅ Complete
```
src/app/(main)/api/v1/invites/validate/route.ts      # Token validation
src/app/(main)/api/v1/auth/register/route.ts         # Registration endpoint
src/app/(main)/(auth)/register/page.tsx              # Registration page
src/app/(main)/api/v1/notifications/route.ts         # List notifications
src/app/(main)/api/v1/notifications/[id]/read/route.ts  # Mark read
src/app/(main)/api/v1/notifications/read-all/route.ts   # Mark all read
src/components/dashboard/notifications-dropdown.tsx  # Dropdown UI
src/lib/notifications.ts                             # Helper functions
supabase/migrations/015_notifications.sql            # DB schema
```

### Modified Files (Phase 1-3) ✅ Complete
```
src/app/(main)/(auth)/login/page.tsx                 # Token handling
src/app/(main)/api/v1/leads/bulk/route.ts            # Added PATCH, notifications
src/app/(main)/api/v1/leads/[id]/route.ts            # Assignment notifications
src/app/(main)/api/v1/invites/accept/route.ts        # Team join notifications
src/components/dashboard/leads-table.tsx             # Assign button, scroll fix
src/components/dashboard/shell.tsx                   # NotificationsDropdown
```

### New Files (Phase 4) ✅ Complete
```
src/lib/email/index.ts                               # Resend client
src/lib/email/templates/invite.ts                    # Invite email template
src/lib/email/templates/lead-assigned.ts             # Assignment email template (single + bulk)
src/lib/email/send-invite.ts                         # Send invite email function
src/lib/email/send-lead-assigned.ts                  # Send assignment email functions
```

### Modified Files (Phase 4) ✅ Complete
```
src/app/(main)/api/v1/invites/route.ts               # Send email on invite
src/app/(main)/api/v1/leads/[id]/route.ts            # Send email on single assignment
src/app/(main)/api/v1/leads/bulk/route.ts            # Send email on bulk assignment
.env.example                                         # Add RESEND_API_KEY
```

---

## Database Changes

### Migration 015: Notifications ✅ Complete
```sql
CREATE TABLE notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id),
  user_id UUID NOT NULL REFERENCES auth.users(id),
  type TEXT NOT NULL,
  title TEXT NOT NULL,
  message TEXT NOT NULL,
  link TEXT,
  read_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT now()
);

-- Indexes
CREATE INDEX idx_notifications_user ON notifications(user_id, read_at);
CREATE INDEX idx_notifications_tenant ON notifications(tenant_id);

-- RLS policies for user isolation
```

### Phase 4 Database Changes
**None required** - emails are sent via external API, no new tables needed.

---

## Summary

### ✅ What's Done (All Phases Complete)
1. Team invite flow with automatic email notifications
2. Registration page for invited users
3. Bulk lead assignment with UI
4. In-app notifications with polished dropdown UI
5. Email notifications via Resend (invite + assignment)
6. Branded HTML email templates with tenant colors

### 🔵 Future Work (Not in Scope)
1. Email digests (daily/weekly)
2. Email preferences per user
3. Sound/animation on new notification
4. "My Leads" dashboard widget
5. Domain verification for production emails

---

## Next Steps

1. ~~**Test emails** in development (invite a user, assign a lead)~~ ✅ Done
2. ~~**Verify domain** in Resend (`lead-crm.zunkireelabs.com`)~~ ✅ Done
3. **Add RESEND_API_KEY** to GitHub Secrets for CI/CD
4. **Deploy to staging** for final testing
5. **Merge to production** when ready
