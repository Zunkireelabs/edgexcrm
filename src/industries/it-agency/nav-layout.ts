/**
 * Declarative sidebar layout for it_agency. Replaces the hand-assembled JSX
 * that used to live at shell.tsx (~160 lines) with data the shell renders
 * from a loop — see docs/archive/features/IT-AGENCY-PHASE5-DELIVERY-NAV-IA-BRIEF.md
 * for the why.
 *
 * Kept out of manifest.ts (which already crosses the Server → Client
 * Component boundary) to keep that diff readable; re-exported from the
 * manifest for discoverability.
 */

import type { NavSection } from "../_types";

/**
 * The typed vocabulary of nav entry keys this layout may reference. An entry
 * key is one of:
 * - `universal:<href>` — a universal nav item the shell renders directly
 *   (Home, Dashboard, Pipeline, Inbox, Org Structure, People, Leave,
 *   Attendance, Company Knowledge — the it_agency labels/icons for these).
 * - `<href>` — an industry item's href, resolved from `industrySidebarItems`
 *   (the manifest's `sidebar[]`, already permission-filtered by
 *   `getIndustrySidebarItems`).
 * - `slot:<name>` — a bespoke Suspense-wrapped slot the shell resolves with
 *   its own logic (lead lists, funnels, archive lists) — these can't be
 *   reduced to a plain item.
 *
 * A union of string literals (not `string`) so a typo'd href is a compile
 * error instead of a silently missing nav item.
 */
export type ItAgencyNavEntryKey =
  | "universal:/home"
  | "universal:/dashboard"
  | "universal:/knowledge-bases"
  | "universal:/pipeline"
  | "universal:/inbox"
  | "universal:/team"
  | "universal:/people"
  | "universal:/leave"
  | "universal:/attendance"
  | "/outreach"
  | "/proposals"
  | "/deals"
  | "/services"
  | "/accounts"
  | "/contacts"
  | "/projects"
  | "/tasks"
  | "/time-tracking"
  | "/approvals"
  | "/resourcing"
  | "/resourcing/utilization"
  | "slot:leads-organise"
  | "slot:leads-funnels"
  | "slot:archive-lists";

interface ItAgencyNavSection extends NavSection {
  entries: readonly ItAgencyNavEntryKey[];
}

/**
 * The target layout (docs/IT-AGENCY-PHASE5-DELIVERY-NAV-IA-BRIEF.md §1b) —
 * match it exactly. The only *content* change vs. the JSX this replaces is
 * Resourcing + Utilization moving from Organization into Delivery; everything
 * else is the same items in the same order.
 */
export const IT_AGENCY_NAV_LAYOUT: readonly ItAgencyNavSection[] = [
  { id: "home", entries: ["universal:/home"] },
  {
    id: "intelligence",
    label: "Intelligence",
    entries: ["universal:/dashboard", "universal:/knowledge-bases"],
  },
  {
    id: "sales",
    label: "Sales",
    entries: [
      "slot:leads-organise",
      "slot:leads-funnels",
      "/outreach",
      "slot:archive-lists",
      "universal:/pipeline",
    ],
  },
  {
    id: "revenue",
    label: "Revenue",
    entries: ["/proposals", "/deals", "/services"],
  },
  {
    id: "clients",
    label: "Clients",
    entries: ["/accounts", "/contacts"],
  },
  {
    id: "delivery",
    label: "Delivery",
    entries: [
      "/projects",
      "/tasks",
      "/time-tracking",
      "/approvals",
      "/resourcing",
      "/resourcing/utilization",
    ],
  },
  {
    id: "communication",
    label: "Communication",
    entries: ["universal:/inbox"],
  },
  {
    id: "organization",
    label: "Organization",
    entries: [
      "universal:/team",
      "universal:/people",
      "universal:/leave",
      "universal:/attendance",
    ],
  },
];
