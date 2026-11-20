import type { lazy, ComponentType } from "react";
import type { Icon } from "@/components/icons";
import { requireOrcaAccess } from "@/lib/ai/orca-access";
import {
  BuildingsIcon,
  RobotIcon,
  UsersIcon,
  ShieldIcon,
  ListChecksIcon,
  GraduationCapIcon,
  ChatTextIcon,
  PlugIcon,
  FileTextIcon,
  CalendarDotsIcon,
} from "@/components/icons";

export interface GatingContext {
  role: string;
  industryId: string | null;
  isEducation: boolean;
  /** role === "owner" || role === "admin" — settings is owner/admin-only (see settings/page.tsx). */
  isSettingsAdmin: boolean;
  /**
   * aiAssistantEnabled && requireOrcaAccess(role) — OWNER ONLY, deliberately
   * narrower than isSettingsAdmin (owner-or-admin). These two genuinely differ
   * now: #482 assumed they were the same. The "AI & Orca" settings tab gates on
   * this, so an admin sees no AI tab while still seeing every other tab.
   */
  isOrcaAvailable: boolean;
}

/**
 * Single source of truth for deriving a {@link GatingContext}. Both the settings
 * modal sidebar and the ⌘K palette build their context through this so the two
 * can never drift on how a role/industry/flag maps to tab visibility.
 */
export function makeGatingContext(input: {
  role: string;
  industryId: string | null;
  aiAssistantEnabled: boolean;
}): GatingContext {
  const isSettingsAdmin = input.role === "owner" || input.role === "admin";
  return {
    role: input.role,
    industryId: input.industryId,
    isEducation: input.industryId === "education_consultancy",
    isSettingsAdmin,
    // Owner-only — narrower than isSettingsAdmin on purpose (see the type doc).
    isOrcaAvailable: input.aiAssistantEnabled && requireOrcaAccess(input.role),
  };
}

export interface SettingsCategory {
  key: string;
  label: string;
  icon: Icon;
  isVisible: (ctx: GatingContext) => boolean;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  panel: ReturnType<typeof lazy<ComponentType<any>>>;
}

// Panels are lazily imported for code-splitting.
// React.lazy is declared here but the actual dynamic() call happens inside
// settings-modal.tsx where "use client" is in scope.
export const SETTINGS_CATEGORIES = [
  {
    key: "general",
    label: "General",
    icon: BuildingsIcon,
    isVisible: () => true,
  },
  {
    key: "ai-orca",
    label: "AI & Orca",
    icon: RobotIcon,
    isVisible: (ctx: GatingContext) => ctx.isOrcaAvailable,
  },
  {
    key: "organization",
    label: "Organization",
    icon: BuildingsIcon,
    isVisible: () => true,
  },
  {
    key: "team-roles",
    label: "Team & Roles",
    icon: ShieldIcon,
    isVisible: () => true,
  },
  {
    key: "lead-management",
    label: "Lead Management",
    icon: ListChecksIcon,
    isVisible: () => true,
  },
  {
    key: "leave",
    label: "Leave",
    icon: CalendarDotsIcon,
    isVisible: () => true,
  },
  {
    key: "academic-operations",
    label: "Academic Operations",
    icon: GraduationCapIcon,
    isVisible: (_ctx: GatingContext) => _ctx.isEducation,
  },
  {
    key: "communications",
    label: "Communications",
    icon: ChatTextIcon,
    isVisible: () => true,
  },
  {
    key: "integrations",
    label: "Integrations",
    icon: PlugIcon,
    isVisible: () => true,
  },
  {
    key: "compliance",
    label: "Compliance",
    icon: FileTextIcon,
    isVisible: (ctx: GatingContext) => ctx.isEducation,
  },
] as const satisfies readonly Omit<SettingsCategory, "panel">[];

/** Every registered settings category key — the single source for tab identity. */
export type SettingsCategoryKey = (typeof SETTINGS_CATEGORIES)[number]["key"];

// Icon map for external references
export { BuildingsIcon as Building2, UsersIcon as Users };
