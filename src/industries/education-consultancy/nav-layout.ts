/**
 * Declarative sidebar layout for education_consultancy (EDGEX-86). Replaces the
 * hand-written JSX block in shell.tsx with data rendered through
 * `resolveNavSections`, exactly like it_agency (see it-agency/nav-layout.ts).
 *
 * Entry keys use the same vocabulary as it_agency:
 * - `universal:<href>` — a universal nav item the shell renders directly.
 * - `<href>` — an industry item resolved from `industrySidebarItems` (the
 *   manifest's `sidebar[]`, already permission-filtered).
 * - `slot:<name>` — a bespoke Suspense-wrapped slot the shell resolves itself.
 *
 * Gating is NOT decided here. The shell resolves every key through the check
 * it used before (`navAllowed`, `eduItem`, `stagingLists.length > 0`), so moving
 * an item between groups never changes who sees it.
 */

import type { NavSection } from "../_types";

export type EducationNavEntryKey =
  | "universal:/home"
  | "universal:/inbox"
  | "/pulse"
  | "/insights/dashboards"
  | "universal:/knowledge-bases"
  | "slot:lead-lists"
  | "universal:/pipeline"
  | "slot:leads-organise"
  | "universal:/contacts"
  | "/applications"
  | "/classes"
  | "/check-in"
  | "/forms"
  | "/campaigns"
  | "/sms"
  | "/email-campaigns"
  | "/outreach"
  | "universal:/team"
  | "universal:/leave"
  | "universal:/attendance";

export interface EducationNavSection extends NavSection {
  entries: readonly EducationNavEntryKey[];
  /** Folded on first visit (before the user has a stored preference). */
  defaultFolded?: boolean;
}

export const EDUCATION_NAV_LAYOUT: readonly EducationNavSection[] = [
  { id: "top", entries: ["universal:/home", "universal:/inbox"] },
  {
    id: "insights",
    label: "Insights",
    entries: ["/pulse", "/insights/dashboards", "universal:/knowledge-bases"],
  },
  {
    id: "leads",
    label: "Leads",
    entries: ["slot:lead-lists", "universal:/pipeline", "slot:leads-organise", "universal:/contacts"],
  },
  {
    id: "students",
    label: "Students",
    entries: ["/applications", "/classes", "/check-in"],
  },
  {
    id: "grow",
    label: "Grow",
    defaultFolded: true,
    entries: ["/forms", "/campaigns", "/sms", "/email-campaigns", "/outreach"],
  },
  {
    id: "team",
    label: "Team",
    defaultFolded: true,
    entries: ["universal:/team", "universal:/leave", "universal:/attendance"],
  },
];

/** Display labels for education (sentence case). Manifest labels may differ. */
export const EDUCATION_NAV_LABELS: Partial<Record<EducationNavEntryKey, string>> = {
  "universal:/knowledge-bases": "Knowledge base",
  "universal:/team": "Org structure",
  "/check-in": "Check-in",
  "/email-campaigns": "Email campaigns",
  "/insights/dashboards": "Dashboards",
};

/** Section ids that start folded, derived from the layout (single source). */
export const EDUCATION_DEFAULT_FOLDED: readonly string[] = EDUCATION_NAV_LAYOUT.filter(
  (s) => s.defaultFolded,
).map((s) => s.id);
