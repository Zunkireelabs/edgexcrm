/**
 * Types for the industry module system.
 *
 * See CLAUDE.md § Industry Scoping Rules and docs/INDUSTRY-MODULES-BRIEF.md
 * for the architecture overview.
 */

import type { LucideIcon } from "lucide-react";
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

/**
 * Sidebar entry contributed by an industry. Rendered alongside the
 * universal nav items in the dashboard shell.
 */
export interface SidebarItem {
  featureId: string;
  href: string;
  label: string;
  icon: LucideIcon;
}

/**
 * Per-industry feature registration. Carries optional config that the
 * shared feature implementation reads to behave per-industry.
 */
export interface FeatureRegistration<TConfig = unknown> {
  meta: FeatureMeta<TConfig>;
  config?: TConfig;
}

/**
 * Slot for industry-specific AI configuration. Empty today; future
 * work adds prompt, tools, knowledge-base references here.
 */
export interface AiConfig {
  systemPrompt?: string;
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
  sidebar: readonly SidebarItem[];
  ai?: AiConfig;
}
