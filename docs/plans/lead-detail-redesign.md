# Lead Detail Page Redesign - Implementation Plan

## Overview

Transform the current basic 2-column lead detail page into a modern, HubSpot-inspired 3-column layout optimized for lead generation CRM workflows.

---

## Current State vs Target State

### Current (Screenshot Analysis)
```
+------------------------------------------+
|  [<] RL Test                    [Delete] |
|  Submitted 2/21/2026 at 2:30:18 PM       |
+------------------------------------------+
|                                          |
|  Personal Information  |  Status & Stage |
|  (mostly empty card)   |  [New badge]    |
|                        |  [Dropdown]     |
|                        +----------------+|
|                        |  Assigned To    |
|                        |  [Dropdown]     |
+------------------------+-----------------+
|  Checklist                               |
|  0/0 completed                           |
|  [Add checklist item...]                 |
+------------------------------------------+
|  Internal Notes                          |
|  Notes are only visible to your team     |
|  [Add a note...]                         |
+------------------------------------------+
```

**Issues:**
- Flat, sparse layout with poor visual hierarchy
- No quick actions for common tasks
- Contact info buried in empty card
- No activity timeline
- No prominent contact display
- Poor information density

### Target (HubSpot-Inspired)
```
+--------------------------------------------------------------------------------+
|  [<] Back    Pratik Paudel                                      [Delete Lead] |
|              Submitted Mar 15, 2024 at 2:30 PM                                 |
+--------------------------------------------------------------------------------+
|                         |                               |                      |
|  LEFT SIDEBAR (280px)   |  CENTER (flex)                |  RIGHT SIDEBAR (320px)
|  +-------------------+  |  [Overview][Notes][Activity]  |  +----------------+ |
|  | +----+            |  |  +-------------------------+  |  | STATUS & STAGE | |
|  | | PP |            |  |  | PERSONAL INFORMATION    |  |  | [Contacted v]  | |
|  | +----+            |  |  | Name: Pratik Paudel     |  |  +----------------+ |
|  | Pratik Paudel     |  |  | Email: pratik@exam...   |  |                    |
|  | pratik@exam...[c] |  |  | Phone: +977-981-...     |  |  +----------------+ |
|  | +977-981-...[c]   |  |  | Location: Kathmandu, NP |  |  | ASSIGNED TO    | |
|  |                   |  |  +-------------------------+  |  | [CE] counselor | |
|  | [Contacted]       |  |                               |  +----------------+ |
|  +-------------------+  |  +-------------------------+  |                    |
|                         |  | CUSTOM FIELDS           |  |  +----------------+ |
|  [Note][Email][Call][+] |  | Degree: Bachelor's      |  |  | CHECKLIST  2/4 | |
|                         |  | Field: Computer Sci     |  |  | [x] Welcome    | |
|  KEY INFORMATION        |  +-------------------------+  |  | [x] Call       | |
|  +-------------------+  |                               |  | [ ] Verify     | |
|  | Location          |  |  +-------------------------+  |  | [ ] Process    | |
|  | Kathmandu, Nepal  |  |  | RECENT NOTES            |  |  +----------------+ |
|  |                   |  |  | "Called to discuss..."  |  |                    |
|  | Created           |  |  | - admin@, Mar 20        |  |  +----------------+ |
|  | Mar 15, 2024      |  |  +-------------------------+  |  | DOCUMENTS      | |
|  +-------------------+  |  [View all notes →]           |  | Transcript.pdf | |
|                         |                               |  | ID_Photo.jpg   | |
|  INTAKE DETAILS         |                               |  +----------------+ |
|  +-------------------+  |                               |                    |
|  | Source: Google    |  |                               |                    |
|  | Campaign: spring  |  |                               |                    |
|  +-------------------+  |                               |                    |
+--------------------------------------------------------------------------------+
```

---

## Information Architecture

### Left Sidebar (Contact Identity)
The **identity anchor** - always visible, never scroll to see who you're working with.

| Section | Content | Priority |
|---------|---------|----------|
| **Contact Card** | Avatar (initials), name, email (copyable), phone (copyable), stage badge | Critical |
| **Quick Actions** | Note, Email, Call, Task buttons | Critical |
| **Key Information** | Location, preferred contact, created date, last updated | High |
| **Intake Details** | Source, medium, campaign (if present) | Medium |
| **Custom Fields** | Dynamic fields from custom_fields JSON | Medium |

### Center Content (Tabbed)
The **workspace** - where detailed information and interactions happen.

| Tab | Content | Default |
|-----|---------|---------|
| **Overview** | Personal info card, custom fields card, recent notes preview | Yes |
| **Notes** | Full note timeline with composer | No |
| **Activity** | System-generated event log (future) | No |

### Right Sidebar (Management)
The **action panel** - status changes, assignments, tasks, documents.

| Section | Content | Admin Only |
|---------|---------|------------|
| **Status & Stage** | Stage dropdown selector | Edit: Yes |
| **Assigned To** | Team member assignment | Edit: Yes |
| **Checklist** | Task items with progress | Add/Delete: Yes |
| **Documents** | File uploads with download/view | - |

---

## Component Architecture

### New Components

```
src/components/dashboard/lead/
├── lead-detail-v2.tsx        # Main 3-column layout container
├── contact-card.tsx          # Avatar + name + contact + quick actions
├── info-section.tsx          # Collapsible section (reusable)
├── lead-tabs.tsx             # Tabbed center content
├── overview-tab.tsx          # Overview tab content
├── notes-tab.tsx             # Notes timeline + composer
├── note-timeline.tsx         # Individual note display
├── management-panel.tsx      # Right sidebar container
├── stage-selector.tsx        # Stage dropdown with colors
├── assignment-card.tsx       # Assigned user display + selector
├── checklist-card.tsx        # Checklist with progress
└── documents-card.tsx        # File list with actions

src/components/ui/
├── copy-button.tsx           # Copy to clipboard with toast
└── collapsible-section.tsx   # Header + chevron + content
```

### Component Hierarchy

```
LeadDetailV2
├── Header (back button, name, timestamp, delete)
├── Grid Container (3-column responsive)
│   ├── Left Sidebar
│   │   ├── ContactCard
│   │   │   ├── Avatar (initials)
│   │   │   ├── Name + Stage Badge
│   │   │   ├── Email + CopyButton
│   │   │   ├── Phone + CopyButton
│   │   │   └── QuickActions (Note, Email, Call, Task)
│   │   ├── InfoSection (Key Information)
│   │   ├── InfoSection (Intake Details) - conditional
│   │   └── InfoSection (Custom Fields) - conditional
│   │
│   ├── Center Content
│   │   └── LeadTabs
│   │       ├── OverviewTab
│   │       │   ├── PersonalInfoCard
│   │       │   ├── CustomFieldsCard
│   │       │   └── RecentNotesPreview
│   │       ├── NotesTab
│   │       │   ├── NoteComposer
│   │       │   └── NoteTimeline
│   │       └── ActivityTab (future)
│   │
│   └── Right Sidebar
│       └── ManagementPanel
│           ├── StageSelector
│           ├── AssignmentCard
│           ├── ChecklistCard
│           └── DocumentsCard
```

---

## Responsive Behavior

| Breakpoint | Layout | Behavior |
|------------|--------|----------|
| **Desktop** (≥1280px) | 3-column: 280px / flex / 320px | Full layout |
| **Tablet** (768-1279px) | 2-column: 280px / flex | Right sidebar stacks below center |
| **Mobile** (<768px) | 1-column | All sections stack, contact card sticky |

### Tailwind Classes
```tsx
// Main grid
<div className="grid grid-cols-1 lg:grid-cols-[280px_1fr] xl:grid-cols-[280px_1fr_320px] gap-6">
```

---

## Data Requirements

### Props Interface

```typescript
interface LeadDetailV2Props {
  lead: Lead;
  notes: LeadNote[];
  checklists: LeadChecklist[];
  stages: PipelineStage[];
  teamMembers: TeamMember[];
  tenant: Tenant;
  role: UserRole;
  userId: string;
}
```

### Computed Values

```typescript
// Contact display
const fullName = `${lead.first_name || ''} ${lead.last_name || ''}`.trim() || 'Unknown';
const initials = getInitials(fullName);
const location = [lead.city, lead.country].filter(Boolean).join(', ');

// Stage info
const currentStage = stages.find(s => s.id === lead.stage_id);
const stageColor = currentStage?.color || '#6b7280';

// Progress
const checklistCompleted = checklists.filter(c => c.is_completed).length;
const checklistTotal = checklists.length;

// Assignment
const assignedMember = teamMembers.find(m => m.user_id === lead.assigned_to);

// Custom fields (filter empty)
const displayCustomFields = Object.entries(lead.custom_fields || {})
  .filter(([_, v]) => v != null && v !== '');

// Documents
const documents = Object.entries(lead.file_urls || {});

// Intake (filter empty)
const hasIntakeInfo = lead.intake_source || lead.intake_medium || lead.intake_campaign;
```

---

## Quick Actions Specification

| Action | Icon | Behavior |
|--------|------|----------|
| **Note** | MessageSquare | Scroll to Notes tab, focus composer |
| **Email** | Mail | Open `mailto:${lead.email}` |
| **Call** | Phone | Open `tel:${lead.phone}` |
| **Task** | CheckSquare | Focus checklist input |
| **More** | MoreHorizontal | Dropdown: Copy link, WhatsApp, Export |

### WhatsApp Deep Link
```typescript
const whatsappUrl = lead.phone
  ? `https://wa.me/${lead.phone.replace(/[^0-9]/g, '')}`
  : null;
```

---

## Styling Specifications

### Avatar Component
```tsx
<div className="h-16 w-16 rounded-full bg-primary/15 flex items-center justify-center">
  <span className="text-lg font-semibold text-primary">{initials}</span>
</div>
```

### Stage Badge
```tsx
<Badge
  style={{
    backgroundColor: `${stageColor}20`,
    color: stageColor
  }}
>
  {currentStage?.name}
</Badge>
```

### Section Headers
```tsx
<h3 className="text-[11px] font-medium text-muted-foreground uppercase tracking-wide">
  KEY INFORMATION
</h3>
```

### Info Rows
```tsx
<div className="space-y-3">
  <div>
    <p className="text-xs text-muted-foreground">Location</p>
    <p className="text-sm font-medium">{location}</p>
  </div>
</div>
```

### Card Styling
```tsx
<Card className="border border-border bg-card">
  <CardContent className="p-4">
    {/* content */}
  </CardContent>
</Card>
```

---

## Implementation Phases

### Phase 1: Core Layout Structure
**Files to create/modify:**
1. `src/components/dashboard/lead/lead-detail-v2.tsx` - Main container
2. `src/components/dashboard/lead/contact-card.tsx` - Contact card
3. `src/components/ui/copy-button.tsx` - Copy utility

**Tasks:**
- [ ] Create 3-column responsive grid
- [ ] Build ContactCard with avatar, name, email, phone
- [ ] Add CopyButton with toast feedback
- [ ] Add stage badge to contact card
- [ ] Implement quick action buttons (Note, Email, Call, Task)

### Phase 2: Left Sidebar Sections
**Files to create:**
4. `src/components/dashboard/lead/info-section.tsx` - Collapsible section

**Tasks:**
- [ ] Build collapsible InfoSection component
- [ ] Add Key Information section (location, created, updated)
- [ ] Add Intake Details section (conditional)
- [ ] Handle empty states (don't show empty fields)

### Phase 3: Center Content - Tabs
**Files to create:**
5. `src/components/dashboard/lead/lead-tabs.tsx` - Tab container
6. `src/components/dashboard/lead/overview-tab.tsx` - Overview content
7. `src/components/dashboard/lead/notes-tab.tsx` - Notes timeline

**Tasks:**
- [ ] Implement tabbed interface with shadcn Tabs
- [ ] Build Overview tab with personal info + custom fields
- [ ] Build Notes tab with timeline layout
- [ ] Add note composer with inline UI
- [ ] Add "View all notes" link from overview

### Phase 4: Right Sidebar - Management Panel
**Files to create:**
8. `src/components/dashboard/lead/management-panel.tsx` - Container
9. `src/components/dashboard/lead/stage-selector.tsx` - Stage dropdown
10. `src/components/dashboard/lead/assignment-card.tsx` - Assignment UI
11. `src/components/dashboard/lead/checklist-card.tsx` - Checklist
12. `src/components/dashboard/lead/documents-card.tsx` - Documents

**Tasks:**
- [ ] Build StageSelector with colored options
- [ ] Build AssignmentCard with avatar + reassign
- [ ] Build ChecklistCard with progress indicator
- [ ] Build DocumentsCard with download/view actions
- [ ] Wire up all API calls for updates

### Phase 5: Polish & Integration
**Tasks:**
- [ ] Update page component to use LeadDetailV2
- [ ] Add responsive behavior testing
- [ ] Add keyboard navigation
- [ ] Add loading states
- [ ] Add error handling
- [ ] Mobile layout refinements

---

## File Changes Summary

### New Files (12)
```
src/components/dashboard/lead/lead-detail-v2.tsx
src/components/dashboard/lead/contact-card.tsx
src/components/dashboard/lead/info-section.tsx
src/components/dashboard/lead/lead-tabs.tsx
src/components/dashboard/lead/overview-tab.tsx
src/components/dashboard/lead/notes-tab.tsx
src/components/dashboard/lead/management-panel.tsx
src/components/dashboard/lead/stage-selector.tsx
src/components/dashboard/lead/assignment-card.tsx
src/components/dashboard/lead/checklist-card.tsx
src/components/dashboard/lead/documents-card.tsx
src/components/ui/copy-button.tsx
```

### Modified Files (1)
```
src/app/(dashboard)/leads/[id]/page.tsx  # Switch to LeadDetailV2
```

### Deprecated (Keep for reference)
```
src/components/dashboard/lead-detail.tsx  # Old component
```

---

## Visual Reference

### Contact Card (280px width)
```
+----------------------------------+
|  +--------+                      |
|  |   PP   |                      |
|  +--------+                      |
|                                  |
|  Pratik Paudel                   |
|  [Contacted]                     |
|                                  |
|  pratik@example.com       [copy] |
|  +977-981-2512514         [copy] |
+----------------------------------+
|  [📝][✉️][📞][✅]    [⋯]        |
+----------------------------------+
```

### Key Information Section
```
+----------------------------------+
|  KEY INFORMATION            [^]  |
+----------------------------------+
|  Location                        |
|  Kathmandu, Nepal                |
|                                  |
|  Preferred Contact               |
|  WhatsApp                        |
|                                  |
|  Created                         |
|  Mar 15, 2024 at 2:30 PM         |
|                                  |
|  Last Updated                    |
|  2 days ago                      |
+----------------------------------+
```

### Checklist Card
```
+----------------------------------+
|  CHECKLIST                  2/4  |
+----------------------------------+
|  [✓] Send welcome email          |
|  [✓] Schedule initial call       |
|  [ ] Verify documents         🗑  |
|  [ ] Process application      🗑  |
|                                  |
|  + Add checklist item...         |
+----------------------------------+
```

### Note Timeline
```
+----------------------------------+
|  [PP] admin@zunkireelabs.com     |
|       2 days ago                 |
|  "Called and discussed program   |
|   options. Student interested    |
|   in Fall 2024 intake."          |
+----------------------------------+
|  [CE] counselor@rku.edu          |
|       Mar 18, 2024               |
|  "Initial contact via email.     |
|   Sent program brochure."        |
+----------------------------------+
```

---

## Quality Checklist

- [ ] 3-column layout renders correctly on desktop
- [ ] 2-column layout on tablet (right sidebar below)
- [ ] Single column on mobile with collapsible sections
- [ ] Empty fields are not displayed
- [ ] Empty sections are not displayed
- [ ] Copy buttons work with toast feedback
- [ ] Quick actions open correct links
- [ ] Stage selector updates via API
- [ ] Assignment selector updates via API
- [ ] Checklist toggles update via API
- [ ] Notes can be added inline
- [ ] Documents can be downloaded/viewed
- [ ] Loading states shown during API calls
- [ ] Error states handled with toast
- [ ] TypeScript types are correct
- [ ] No console errors
- [ ] Accessible (keyboard nav, aria labels)
