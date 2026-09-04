import type { lazy, ComponentType } from "react";
import type { LucideIcon } from "lucide-react";
import { requireOrcaAccess } from "@/lib/ai/orca-access";
import {
  Building2,
  Bot,
  Users,
  Shield,
  ListChecks,
  GraduationCap,
  MessageSquare,
  Plug,
  FileCheck,
  CalendarClock,
} from "lucide-react";

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
  icon: LucideIcon;
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
    icon: Building2,
    isVisible: () => true,
  },
  {
    key: "ai-orca",
    label: "AI & Orca",
    icon: Bot,
    isVisible: (ctx: GatingContext) => ctx.isOrcaAvailable,
  },
  {
    key: "organization",
    label: "Organization",
    icon: Building2,
    isVisible: () => true,
  },
  {
    key: "team-roles",
    label: "Team & Roles",
    icon: Shield,
    isVisible: () => true,
  },
  {
    key: "lead-management",
    label: "Lead Management",
    icon: ListChecks,
    isVisible: () => true,
  },
  {
    key: "leave",
    label: "Leave",
    icon: CalendarClock,
    isVisible: () => true,
  },
  {
    key: "academic-operations",
    label: "Academic Operations",
    icon: GraduationCap,
    isVisible: (_ctx: GatingContext) => _ctx.isEducation,
  },
  {
    key: "communications",
    label: "Communications",
    icon: MessageSquare,
    isVisible: () => true,
  },
  {
    key: "integrations",
    label: "Integrations",
    icon: Plug,
    isVisible: () => true,
  },
  {
    key: "compliance",
    label: "Compliance",
    icon: FileCheck,
    isVisible: (ctx: GatingContext) => ctx.isEducation,
  },
] as const satisfies readonly Omit<SettingsCategory, "panel">[];

/** Every registered settings category key — the single source for tab identity. */
export type SettingsCategoryKey = (typeof SETTINGS_CATEGORIES)[number]["key"];

// Icon map for external references
export { Building2, Users };
