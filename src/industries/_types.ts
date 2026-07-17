/**
 * Types for the industry module system.
 *
 * See CLAUDE.md § Industry Scoping Rules and docs/INDUSTRY-MODULES-BRIEF.md
 * for the architecture overview.
 */

import type { IndustryId } from "./_registry";

/**
 * Metadata for a feature — identity + which industries can use it.
 *
 * Lives next to the feature implementation (e.g.
 * `industries/education-consultancy/features/check-in/meta.ts`).
 * The `industries` array names every industry that this feature is
 * available to; for industry-scoped features this is one industry, for
 * shared features it lists every industry that opts in.
 */
export interface FeatureMeta<TConfig = unknown> {
  id: string;
  industries: readonly IndustryId[];
  defaultConfig?: TConfig;
}

type SidebarPosition = "after-home" | "before-pipeline" | "after-pipeline";

/**
 * Sidebar entry contributed by an industry. Rendered alongside the
 * universal nav items in the dashboard shell.
 *
 * `icon` is a string name (e.g. "UserCheck") so the manifest stays
 * serializable across the Server Component → Client Component
 * boundary. The dashboard shell resolves the name to a Lucide
 * component via its INDUSTRY_ICONS registry — add a new icon there
 * when you reference it from a manifest.
 */
export interface SidebarItem {
  kind?: "item";
  position?: SidebarPosition;
  featureId: string;
  href: string;
  label: string;
  icon: string;
  /**
   * If present, only show this sidebar item to users whose role is in
   * the list. Mirrors role gates already enforced at the API / page
   * level — this just hides the nav entry. Absent = visible to all
   * roles in the tenant.
   */
  minRoles?: readonly ("owner" | "admin" | "viewer" | "counselor")[];
  /**
   * If present, only show to users whose positionSlug is in the list OR
   * whose baseTier is "owner" or "admin" (admins always pass). Absent = no
   * position restriction.
   */
  allowedPositions?: readonly string[];
  /**
   * Hide from users who already see all leads: owner/admin (role) and
   * branch managers (leadScope "team"). All other positions still see it.
   */
  hideForBroadScope?: boolean;
}

/**
 * Collapsible group of SidebarItems contributed by an industry.
 * Renders as an expandable parent with indented children in the shell.
 *
 * `id` is a stable identifier used as a React key and reserved for
 * future localStorage persistence of collapse state.
 */
export interface SidebarGroup {
  kind: "group";
  position?: SidebarPosition;
  id: string;
  label: string;
  icon: string;
  children: readonly SidebarItem[];
}

/** Discriminated union for an industry manifest sidebar entry. */
export type SidebarEntry = SidebarItem | SidebarGroup;

/**
 * Per-industry feature registration. Carries optional config that the
 * shared feature implementation reads to behave per-industry.
 */
export interface FeatureRegistration<TConfig = unknown> {
  meta: FeatureMeta<TConfig>;
  config?: TConfig;
}

/**
 * Per-industry AI configuration, declared in the industry's manifest.
 * MUST stay JSON-serializable (strings/arrays only — manifests may cross
 * the RSC boundary; same rule as sidebar icon names).
 */
export interface AiConfig {
  /**
   * Appended verbatim to the END of the universal assistant system prompt.
   * Domain context + tool-routing hints for this industry. NOT a replacement
   * prompt — the universal prompt (role awareness, tool rules, injection
   * rule) always applies.
   */
  promptAddendum?: string;
  /**
   * Ids of tools gated to this industry — wherever they live: an industry
   * pack folder (src/industries/<id>/ai/tools/) or an industries-gated tool
   * in the universal folder (e.g. get_form_submissions_summary). Kept in
   * sync with the actual registrations by a consistency test.
   */
  toolIds?: readonly string[];
}

/**
 * The manifest each industry exports as its `manifest.ts`. The loader
 * reads these to decide what features render for a given tenant and
 * what nav items appear in the sidebar.
 */
export interface IndustryManifest {
  id: IndustryId;
  features: readonly FeatureRegistration[];
  sidebar: readonly SidebarEntry[];
  ai?: AiConfig;
}
